import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, sql } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { hashPassword } from "better-auth/crypto";
import * as schema from "../src/server/db/schema";
import { staffAuthOptions } from "../src/server/auth/options";
import { createAuthorization, currentStaffSessionConditions, type AuthSession } from "../src/server/auth/authorize";
import { createUserManagement } from "../src/server/admin/service";
import { auditQuery, managementLock } from "../src/server/admin/queries";
import type { ManagedUser } from "../src/server/admin/contracts";

test("admin management uses current authorization and atomic isolated PostgreSQL writes", async (t) => {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const auth = betterAuth({ ...staffAuthOptions, database: drizzleAdapter(db, { provider: "pg", schema }),
    secret: "isolated-admin-secret-at-least-32-characters", baseURL: "http://localhost:3000",
    advanced: { useSecureCookies: false }, logger: { disabled: true } });
  let requestHeaders = new Headers();
  const password = "isolated-password-12345";
  const passwordHash = await hashPassword(password);
  async function addUser(role: ManagedUser["role"], active = true, name = "Team member") {
    const id = crypto.randomUUID();
    const [row] = await db.insert(schema.user).values({ id, name, email: `${id}@example.test`, role, active }).returning();
    assert.ok(row);
    await db.insert(schema.account).values({ id, accountId: id, userId: id, providerId: "credential", password: passwordHash });
    return row;
  }
  async function signIn(who: { email: string }) {
    const response = await auth.api.signInEmail({ body: { email: who.email, password }, asResponse: true });
    assert.equal(response.status, 200);
    requestHeaders = new Headers({ cookie: response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ") });
    const identity = await readSession(); assert.ok(identity); return identity;
  }
  const readSession = () => auth.api.getSession({ headers: requestHeaders, query: { disableCookieCache: true } });
  const access = createAuthorization({
    redirect: () => { throw new Error("Redirect"); }, readSession,
    findStaff: async (identity) => (await db.select({ id: schema.user.id, role: schema.user.role, active: schema.user.active })
      .from(schema.session).innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
      .where(currentStaffSessionConditions(identity)).limit(1))[0],
  });
  const storage = {
    list: async (query: Parameters<typeof db.execute>[0]) => (await db.execute<ManagedUser>(query)).rows,
    change: async (query: Parameters<typeof db.execute>[0]) => db.transaction(async (tx) => {
      await tx.execute(managementLock);
      return (await tx.execute<{ ok: boolean }>(query)).rows[0]?.ok === true;
    }),
  };
  const management = createUserManagement({ authorize: access.getPermissionSession, ...storage });
  function stale(identity: AuthSession) {
    return createUserManagement({ ...storage, authorize: async () => ({ ...identity, staff: { id: identity.user.id, active: true, role: "super_admin" } }) });
  }
  const expected = (u: { id: string; role: string; active: boolean }) => ({ targetId: u.id, expectedRole: u.role, expectedActive: u.active });
  const getUser = async (id: string) => (await db.select().from(schema.user).where(eq(schema.user.id, id)))[0]!;
  const audits = () => db.select().from(schema.adminAudit);
  try {
    await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
    const staff = await addUser("staff"); const admin = await addUser("admin"); const root = await addUser("super_admin");
    const secondRoot = await addUser("super_admin");
    await t.test("unauthenticated and staff requests cannot list or mutate accounts", async () => {
      for (const who of [null, staff]) {
        requestHeaders = new Headers(); if (who) await signIn(who);
        await assert.rejects(management.list({}), /Access denied/);
        for (const mutation of [{ kind: "role", role: "super_admin" }, { kind: "status", active: false }]) {
          assert.equal((await management.change({ ...expected(admin), ...mutation })).ok, false);
        }
      }
      assert.equal((await audits()).length, 0);
    });
    await t.test("admin and super admin can list, filter, search and paginate without secrets", async () => {
      await addUser("staff", false, "Needle 100%_unique");
      for (const who of [admin, root]) {
        await signIn(who);
        const result = await management.list({ search: "100%_unique", role: "staff", status: "inactive" });
        assert.equal(result.users.length, 1);
        assert.deepEqual(Object.keys(result.users[0]!).sort(), ["active", "email", "id", "name", "role"]);
        assert.equal((await management.list({ search: "' OR true --" })).users.length, 0);
        assert.equal((await management.list({ role: "admin", status: "active" })).users.length, 1);
        assert.equal((await management.list({ page: 2 })).users.length, 0);
        await assert.rejects(management.list({ page: -1 }));
        await assert.rejects(management.list({ role: "owner" }));
      }
      for (let i = 0; i < 26; i++) await addUser("staff", true, `Paged ${i.toString().padStart(2, "0")}`);
      const first = await management.list({ search: "Paged" }); const second = await management.list({ search: "Paged", page: 2 });
      assert.equal(first.users.length, 25); assert.equal(first.hasMore, true);
      assert.equal(second.users.length, 1); assert.equal(second.hasMore, false);
      assert.ok(!first.users.some((u) => u.id === second.users[0]!.id));
    });
    await t.test("admin cannot assign roles or change privileged accounts, including crafted stale authorization", async () => {
      const identity = await signIn(admin);
      for (const api of [management, stale(identity)]) {
        assert.equal((await api.change({ ...expected(staff), kind: "role", role: "super_admin" })).ok, false);
        for (const who of [admin, root, secondRoot]) assert.equal((await api.change({ ...expected(who), kind: "status", active: false })).ok, false);
      }
      assert.equal((await getUser(root.id)).active, true);
    });
    await t.test("admin deactivates staff, revokes all sessions, records audit, then reactivates without restoring sessions", async () => {
      const one = await signIn(staff); const two = await signIn(staff);
      await signIn(admin);
      assert.equal((await management.change({ ...expected(staff), kind: "status", active: false })).ok, true);
      assert.equal((await getUser(staff.id)).active, false);
      assert.equal((await db.select().from(schema.session).where(eq(schema.session.userId, staff.id))).length, 0);
      assert.equal((await stale(one).change({ ...expected(admin), kind: "status", active: false })).ok, false);
      assert.equal((await stale(two).change({ ...expected(admin), kind: "status", active: false })).ok, false);
      const [entry] = await audits(); assert.ok(entry);
      assert.equal(entry.actorId, admin.id); assert.equal(entry.targetId, staff.id); assert.equal(entry.action, "status");
      assert.equal(entry.beforeActive, true); assert.equal(entry.afterActive, false);
      assert.equal((await management.change({ ...expected(staff), expectedActive: false, kind: "status", active: true })).ok, true);
      assert.equal((await db.select().from(schema.session).where(eq(schema.session.userId, staff.id))).length, 0);
    });
    await t.test("super admin assigns every role and revokes sessions on role changes", async () => {
      const target = await addUser("staff"); await signIn(target); await signIn(root);
      for (const role of ["admin", "super_admin", "staff"] as const) {
        const before = await getUser(target.id);
        assert.equal((await management.change({ ...expected(before), kind: "role", role })).ok, true);
        assert.equal((await getUser(target.id)).role, role);
        assert.equal((await db.select().from(schema.session).where(eq(schema.session.userId, target.id))).length, 0);
        const entry = (await audits()).find((entry) => entry.targetId === target.id && entry.afterRole === role);
        assert.equal(entry?.beforeRole, before.role);
      }
    });
    await t.test("super admin can change privileged status but cannot demote or deactivate self", async () => {
      await signIn(root);
      for (const who of [admin, secondRoot]) {
        assert.equal((await management.change({ ...expected(who), kind: "status", active: false })).ok, true);
        assert.equal((await management.change({ ...expected(who), expectedActive: false, kind: "status", active: true })).ok, true);
      }
      assert.equal((await management.change({ ...expected(root), kind: "role", role: "staff" })).ok, false);
      assert.equal((await management.change({ ...expected(root), kind: "status", active: false })).ok, false);
    });
    await t.test("strict validation rejects unknown roles, fields, coercion and missing target; stale confirmations deny", async () => {
      await signIn(root); const beforeCount = (await audits()).length;
      for (const input of [null, {}, { ...expected(staff), kind: "role", role: "owner" },
        { ...expected(staff), kind: "status", active: "false" }, { ...expected(staff), kind: "status", active: false, actorId: root.id },
        { ...expected(staff), targetId: "missing", kind: "status", active: false },
        { ...expected(staff), expectedRole: "admin", kind: "status", active: false },
        { ...expected(staff), expectedActive: false, kind: "status", active: true },
        { ...expected(staff), kind: "role", role: "staff" }]) {
        assert.equal((await management.change(input)).ok, false);
      }
      assert.equal((await audits()).length, beforeCount);
    });
    await t.test("expired, revoked, inactive and downgraded actors fail again inside the write transaction", async () => {
      for (const reason of ["expired", "revoked", "inactive", "downgraded"] as const) {
        const actor = await addUser("super_admin"); const identity = await signIn(actor);
        if (reason === "expired") await db.update(schema.session).set({ expiresAt: new Date(0) }).where(eq(schema.session.id, identity.session.id));
        if (reason === "revoked") await db.delete(schema.session).where(eq(schema.session.id, identity.session.id));
        if (reason === "inactive") await db.update(schema.user).set({ active: false }).where(eq(schema.user.id, actor.id));
        if (reason === "downgraded") await db.update(schema.user).set({ role: "staff" }).where(eq(schema.user.id, actor.id));
        assert.equal((await management.change({ ...expected(staff), kind: "status", active: false })).ok, false);
        assert.equal((await stale(identity).change({ ...expected(staff), kind: "status", active: false })).ok, false);
        assert.equal((await getUser(staff.id)).active, true);
        assert.equal((await db.execute<ManagedUser>(auditQuery(identity))).rows.length, 0);
      }
    });
    await t.test("audit insert failure rolls back account change and revocation", async () => {
      const target = await addUser("staff"); await signIn(target); await signIn(root);
      await db.execute(sql`create function fail_test_audit() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable'; end; $$`);
      await db.execute(sql`create trigger fail_test_audit before insert on admin_audit for each row execute function fail_test_audit()`);
      await assert.rejects(management.change({ ...expected(target), kind: "status", active: false }));
      assert.equal((await getUser(target.id)).active, true);
      assert.equal((await db.select().from(schema.session).where(eq(schema.session.userId, target.id))).length, 1);
      await db.execute(sql`drop trigger fail_test_audit on admin_audit`);
    });
    await t.test("audit history is append-only and readable only with audit permission", async () => {
      await assert.rejects(db.execute(sql`update admin_audit set action = 'role'`));
      await assert.rejects(db.execute(sql`delete from admin_audit`));
      await assert.rejects(db.execute(sql`truncate admin_audit`));
      for (const who of [staff, admin, root]) {
        const identity = await signIn(who);
        const rows = (await db.execute(auditQuery(identity))).rows;
        assert.equal(rows.length > 0, who.id === root.id);
      }
    });
    await t.test("inactive users cannot create new sessions to replay after reactivation", async () => {
      const inactive = await addUser("staff", false);
      // The internal API propagates adapter failures; the HTTP handler returns a
      // generic error. Assert the real handler never exposes SQL/session secrets.
      const response = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ email: inactive.email, password }),
      }));
      assert.notEqual(response.status, 200);
      assert.doesNotMatch(await response.text(), /insert into|params:|session.*token/i);
      await assert.rejects(db.insert(schema.session).values({ id: crypto.randomUUID(), token: crypto.randomUUID(), userId: inactive.id, expiresAt: new Date(Date.now() + 60000) }));
    });
    await t.test("account CRUD validates, hashes credentials, prevents duplicates and preserves audit history", async () => {
      const input = { name: "New member", email: "NEW-MEMBER@example.test", password, role: "staff", active: true };
      for (const who of [null, staff, admin]) {
        requestHeaders = new Headers(); if (who) await signIn(who);
        assert.equal((await management.create(input)).ok, false);
      }
      await signIn(root);
      for (const bad of [{ ...input, password: "short" }, { ...input, role: "owner" },
        { ...input, email: "invalid" }, { ...input, name: " " }, { ...input, actorId: root.id }]) {
        assert.equal((await management.create(bad)).ok, false);
      }
      assert.equal((await management.create(input)).ok, true);
      const created = (await management.list({ search: "new-member@example.test" })).users[0]!;
      assert.equal(created.email, "new-member@example.test");
      assert.equal((await management.create(input)).ok, false);
      const [credential] = await db.select().from(schema.account).where(eq(schema.account.userId, created.id));
      assert.ok(credential?.password); assert.notEqual(credential.password, password);
      const signed = await auth.api.signInEmail({ body: { email: created.email, password }, asResponse: true });
      assert.equal(signed.status, 200);
      const edit = { ...expected(created), expectedName: created.name, expectedEmail: created.email,
        kind: "profile", name: "Updated member", email: "updated-member@example.test" };
      assert.equal((await management.change({ ...edit, email: root.email })).ok, false);
      assert.equal((await management.change(edit)).ok, true);
      assert.equal((await management.change(edit)).ok, false);
      assert.equal((await db.select().from(schema.session).where(eq(schema.session.userId, created.id))).length, 0);
      const updated = await getUser(created.id);
      assert.equal(updated.name, "Updated member"); assert.equal(updated.emailVerified, false);
      const remove = { ...expected(updated), expectedName: updated.name, expectedEmail: updated.email, kind: "delete" };
      for (const who of [staff, admin]) {
        const identity = await signIn(who);
        for (const api of [management, stale(identity)]) {
          assert.equal((await api.change(remove)).ok, false);
          assert.equal((await api.change(edit)).ok, false);
          assert.equal((await api.create({ ...input, email: `${who.id}@new.test` })).ok, false);
        }
      }
      await signIn(updated);
      await signIn(root);
      const own = { ...expected(root), expectedName: root.name, expectedEmail: root.email };
      assert.equal((await management.change({ ...own, kind: "delete" })).ok, false);
      assert.equal((await management.change({ ...own, kind: "profile", name: "Oops", email: root.email })).ok, false);
      assert.equal((await management.change(remove)).ok, true);
      assert.equal(await getUser(created.id), undefined);
      assert.equal((await db.select().from(schema.account).where(eq(schema.account.userId, created.id))).length, 0);
      assert.equal((await db.select().from(schema.session).where(eq(schema.session.userId, created.id))).length, 0);
      assert.deepEqual((await audits()).filter((a) => a.targetId === created.id).map((a) => a.action), ["create", "profile", "delete"]);
    });
    await t.test("inventory actors cannot be deleted and can still be deactivated", async () => {
      const target = await addUser("staff"); await signIn(root);
      const [brand] = await db.insert(schema.brands).values({ name: "CRUD brand", slug: "crud-brand" }).returning();
      const [category] = await db.insert(schema.categories).values({ name: "CRUD category", slug: "crud-category" }).returning();
      const [product] = await db.insert(schema.products).values({ name: "CRUD product", slug: "crud-product", brandId: brand!.id, categoryId: category!.id }).returning();
      const [variant] = await db.insert(schema.productVariants).values({ productId: product!.id, sku: "CRUD-SKU", price: 100 }).returning();
      const [location] = await db.select().from(schema.inventoryLocations);
      await db.insert(schema.inventoryBalances).values({ variantId: variant!.id, locationId: location!.id, onHand: 1 });
      await db.insert(schema.inventoryMovements).values({ variantId: variant!.id, locationId: location!.id,
        actorId: target.id, type: "ADJUSTMENT_IN", quantity: 1, beforeOnHand: 0, afterOnHand: 1,
        beforeReserved: 0, afterReserved: 0, reason: "Fixture", requestId: crypto.randomUUID() });
      const deletion = { ...expected(target), expectedName: target.name, expectedEmail: target.email, kind: "delete" };
      assert.equal((await management.change(deletion)).ok, false);
      assert.ok(await getUser(target.id));
      assert.equal((await management.change({ ...expected(target), kind: "status", active: false })).ok, true);
    });
    await t.test("stale authorization and audit failures cannot create, edit or delete accounts", async () => {
      const actor = await addUser("super_admin"); const identity = await signIn(actor);
      const target = await addUser("staff");
      const profile = { ...expected(target), expectedName: target.name, expectedEmail: target.email,
        kind: "profile", name: "Modified", email: "modified@example.test" };
      const create = { name: "Rollback", email: "rollback@example.test", password, role: "staff", active: true };
      await db.delete(schema.session).where(eq(schema.session.id, identity.session.id));
      assert.equal((await stale(identity).create(create)).ok, false);
      assert.equal((await stale(identity).change(profile)).ok, false);
      const { name: _newName, email: _newEmail, ...staleDelete } = profile;
      void _newName; void _newEmail;
      assert.equal((await stale(identity).change({ ...staleDelete, kind: "delete" })).ok, false);
      await signIn(target);
      await signIn(root);
      await db.execute(sql`create trigger fail_test_audit before insert on admin_audit for each row execute function fail_test_audit()`);
      await assert.rejects(management.create(create));
      await assert.rejects(management.change(profile));
      const { name: _name, email: _email, ...deletion } = profile;
      void _name; void _email;
      await assert.rejects(management.change({ ...deletion, kind: "delete" }));
      assert.equal((await getUser(target.id)).name, target.name);
      assert.equal((await db.select().from(schema.session).where(eq(schema.session.userId, target.id))).length, 1);
      assert.equal((await db.select().from(schema.user).where(eq(schema.user.email, create.email))).length, 0);
      await db.execute(sql`drop trigger fail_test_audit on admin_audit`);
    });
    await t.test("competing stale super-admin demotions leave an active super admin; final self-removal denies", async () => {
      // Normalize fixture roles to exactly two active super admins.
      await db.update(schema.user).set({ role: "staff" });
      await db.update(schema.user).set({ role: "super_admin", active: true }).where(eq(schema.user.id, root.id));
      await db.update(schema.user).set({ role: "super_admin", active: true }).where(eq(schema.user.id, secondRoot.id));
      const one = await signIn(root); const two = await signIn(secondRoot);
      const results = await Promise.all([
        stale(one).change({ ...expected(secondRoot), kind: "role", role: "staff" }),
        stale(two).change({ ...expected(root), kind: "role", role: "staff" }),
      ]);
      assert.equal(results.filter((result) => result.ok).length, 1);
      const remaining = (await db.select().from(schema.user)).filter((u) => u.active && u.role === "super_admin");
      assert.equal(remaining.length, 1);
      await signIn(remaining[0]!);
      assert.equal((await management.change({ ...expected(remaining[0]!), kind: "status", active: false })).ok, false);
      assert.equal((await management.change({ ...expected(remaining[0]!), kind: "role", role: "admin" })).ok, false);
    });
  } finally { await client.close(); }
});
