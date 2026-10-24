import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { hashPassword } from "better-auth/crypto";
import * as schema from "../src/server/db/schema";
import { staffAuthOptions } from "../src/server/auth/options";
import {
  createAuthorization, currentStaffSessionConditions, hasPermission, permissions,
  type Permission,
} from "../src/server/auth/authorize";

// No environment loading, Neon connections, or production credentials.
test("authorization with real Better Auth sessions and isolated PostgreSQL", async (t) => {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const auth = betterAuth({
    ...staffAuthOptions,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    secret: "isolated-test-secret-with-at-least-32-characters",
    baseURL: "http://localhost:3000",
    advanced: { useSecureCookies: false },
    logger: { disabled: true },
  });
  let requestHeaders = new Headers();
  const readSession = () => auth.api.getSession({ headers: requestHeaders, query: { disableCookieCache: true } });
  async function findStaff(identity: NonNullable<Awaited<ReturnType<typeof readSession>>>) {
    const [staff] = await db.select({ id: schema.user.id, active: schema.user.active, role: schema.user.role })
      .from(schema.session).innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
      .where(currentStaffSessionConditions(identity)).limit(1);
    return staff;
  }
  function redirect(path: string): never {
    throw Object.assign(new Error("Redirect"), { digest: `NEXT_REDIRECT;replace;${path};307;` });
  }
  const access = createAuthorization({ redirect, readSession, findStaff });
  const password = "isolated-password-12345";
  const redirectTo = (path: string) => (error: unknown) =>
    error instanceof Error && "digest" in error && String(error.digest).includes(`;${path};`);
  async function signIn(role: "staff" | "admin" | "super_admin", active = true) {
    const id = crypto.randomUUID();
    const email = `${id}@example.test`;
    await db.insert(schema.user).values({ id, name: "Test", email, role, active });
    await db.insert(schema.account).values({ id, accountId: id, userId: id, providerId: "credential", password: await hashPassword(password) });
    const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    assert.equal(response.status, 200);
    requestHeaders = new Headers({ cookie: response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ") });
    const identity = await readSession();
    assert.ok(identity);
    return identity;
  }
  try {
    await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
    await t.test("unauthenticated requests are denied", async () => {
      assert.equal(await access.getStaffSession(), null);
      for (const permission of permissions) assert.equal(await access.getPermissionSession(permission), null);
      await assert.rejects(access.requireStaff(), redirectTo("/admin/login"));
    });
    for (const role of ["staff", "admin", "super_admin"] as const) {
      await t.test(`${role}: explicit operation permissions and compatibility helpers`, async () => {
        await signIn(role);
        const allowed = role === "super_admin" ? permissions : ["admin:access", "dashboard:read", "session:read"];
        for (const permission of permissions) {
          assert.equal(Boolean(await access.getPermissionSession(permission)), allowed.includes(permission));
          if (allowed.includes(permission)) assert.equal((await access.requirePermission(permission)).staff.role, role);
          else await assert.rejects(access.requirePermission(permission), redirectTo("/admin"));
        }
        assert.equal((await access.requireStaff()).staff.role, role);
        if (role === "super_admin") assert.equal((await access.requireSuperAdmin()).staff.role, role);
        else await assert.rejects(access.requireSuperAdmin(), redirectTo("/admin"));
        assert.equal(await access.getPermissionSession("users:write" as Permission), null);
        await assert.rejects(access.requirePermission("unknown" as Permission), redirectTo("/admin"));
      });
      await t.test(`${role}: inactive accounts cannot use existing sessions`, async () => {
        const identity = await signIn(role);
        await db.update(schema.user).set({ active: false }).where(eq(schema.user.id, identity.user.id));
        for (const permission of permissions) assert.equal(await access.getPermissionSession(permission), null);
        await assert.rejects(access.requireStaff(), redirectTo("/admin/login"));
      });
    }
    await t.test("current database role overrides previously issued claims", async () => {
      const identity = await signIn("super_admin");
      const stale = createAuthorization({ redirect, readSession: async () => identity, findStaff });
      await db.update(schema.user).set({ role: "staff" }).where(eq(schema.user.id, identity.user.id));
      assert.equal((await stale.getStaffSession())?.staff.role, "staff");
      assert.equal(await stale.getPermissionSession("super_admin:access"), null);
      assert.equal((await stale.requireStaff()).staff.role, "staff");
    });
    await t.test("revoked sessions cannot be replayed, including stale identities", async () => {
      const identity = await signIn("super_admin");
      const stale = createAuthorization({ redirect, readSession: async () => identity, findStaff });
      await db.delete(schema.session).where(eq(schema.session.id, identity.session.id));
      assert.equal(await readSession(), null);
      assert.equal(await access.getStaffSession(), null);
      assert.equal(await stale.getStaffSession(), null);
    });
    await t.test("expired database sessions deny even a stale unexpired identity", async () => {
      const identity = await signIn("super_admin");
      const stale = createAuthorization({ redirect, readSession: async () => identity, findStaff });
      await db.update(schema.session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.session.id, identity.session.id));
      assert.equal(await stale.getStaffSession(), null);
      assert.equal(await readSession(), null);
      assert.equal(await access.getStaffSession(), null);
    });
    await t.test("expired, mismatched, or deleted identities fail closed", async () => {
      const identity = await signIn("staff");
      const expired = createAuthorization({ redirect, readSession: async () => ({ ...identity, session: { ...identity.session, expiresAt: new Date(0) } }), findStaff });
      assert.equal(await expired.getStaffSession(), null);
      const mismatch = createAuthorization({ redirect, readSession: async () => ({ ...identity, user: { ...identity.user, id: "another-user" } }), findStaff });
      assert.equal(await mismatch.getStaffSession(), null);
      const wrongToken = createAuthorization({ redirect, readSession: async () => ({ ...identity, session: { ...identity.session, token: "forged" } }), findStaff });
      assert.equal(await wrongToken.getStaffSession(), null);
      await db.delete(schema.user).where(eq(schema.user.id, identity.user.id));
      assert.equal(await access.getStaffSession(), null);
    });
    await t.test("unknown roles and permissions deny, including prototype property names", async () => {
      for (const role of ["owner", "", "toString", "__proto__"]) {
        for (const permission of permissions) assert.equal(hasPermission(role, permission), false);
      }
      for (const role of ["staff", "admin", "super_admin"]) assert.equal(hasPermission(role, "users:write"), false);
      const identity = await signIn("staff");
      const unknown = createAuthorization({ redirect, readSession: async () => identity, findStaff: async () => ({ id: identity.user.id, role: "owner", active: true }) });
      assert.equal(await unknown.getStaffSession(), null);
    });
    await t.test("session renewal extends expiry without granting additional access", async () => {
      const identity = await signIn("staff");
      const oldExpiry = new Date(Date.now() + 7 * 60 * 60 * 1000);
      await db.update(schema.session).set({ expiresAt: oldExpiry, updatedAt: new Date(Date.now() - 3600000) }).where(eq(schema.session.id, identity.session.id));
      const renewed = await readSession();
      assert.ok(renewed && renewed.session.expiresAt.getTime() > oldExpiry.getTime());
      assert.equal(await access.getPermissionSession("super_admin:access"), null);
      const [stored] = await db.select().from(schema.session).where(eq(schema.session.id, identity.session.id));
      assert.equal(stored?.expiresAt.getTime(), renewed.session.expiresAt.getTime());
    });
    await t.test("logout deletes the session and replaying the cookie is rejected", async () => {
      const identity = await signIn("admin");
      await auth.api.signOut({ headers: requestHeaders });
      assert.equal((await db.select().from(schema.session).where(eq(schema.session.id, identity.session.id))).length, 0);
      assert.equal(await access.getStaffSession(), null);
    });
    await t.test("database failures propagate without permitting access", async () => {
      const identity = await signIn("staff");
      const unavailable = createAuthorization({ redirect, readSession: async () => identity, findStaff: async () => { throw new Error("Database unavailable"); } });
      await assert.rejects(unavailable.requireStaff(), /Database unavailable/);
    });
  } finally {
    await client.close();
  }
});
