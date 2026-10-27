import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { catalogFixture } from "./catalog-fixture";
import { createCatalogMutations, type MutationStorage } from "../src/server/catalog/mutations";
import { managementLock } from "../src/server/admin/queries";

test("Phase 2B real PostgreSQL constraints, audit and rollback (serialized PGlite adapter)", async (t) => {
  const f = await catalogFixture(); const { db, client, schema, data } = f;
  const change: MutationStorage["change"] = (query) => db.transaction(async (tx) => {
    await tx.execute(managementLock);
    return (await tx.execute<{ authorized: boolean; found: boolean; changed: boolean }>(query)).rows[0];
  });
  const api = createCatalogMutations({ authorize: f.storage.authorize, change });
  const input = (slug = `test-${crypto.randomUUID()}`) => ({ name: "Test paddle", slug, brandId: data.brands[0]!.id, categoryId: data.categories[0]!.id });
  const get = async (id: string) => (await db.select().from(schema.products).where(eq(schema.products.id, id)))[0]!;
  const count = () => db.$count(schema.catalogAudit);
  let id: string; let actorId: string;
  try {
    await t.test("unauthenticated and staff accounts cannot mutate", async () => {
      assert.equal((await api.createProduct(input())).ok, false);
      await f.signIn("staff");
      for (const result of [await api.createProduct(input()), await api.updateProduct(data.products[0]!.id, { name: "Denied" }),
        await api.archiveProduct(data.products[0]!.id), await api.reactivateProduct(data.products[0]!.id)]) {
        assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, "FORBIDDEN");
      }
      assert.equal(await count(), 0);
    });
    await t.test("authorized create normalizes slug, defaults to draft and audits actor and product", async () => {
      actorId = (await f.signIn()).user.id;
      const r = await api.createProduct({ ...input("  Test Paddle! "), description: "Description" }); assert.ok(r.ok); id = r.productId;
      assert.equal(r.changed, true); const p = await get(id); assert.equal(p.slug, "test-paddle"); assert.equal(p.status, "draft");
      const [audit] = await db.select().from(schema.catalogAudit); assert.ok(audit);
      assert.equal(audit.actorId, actorId); assert.equal(audit.productId, id); assert.equal(audit.action, "create"); assert.ok(audit.createdAt);
      const details = audit.changes as { before: unknown; after: { status: string; descriptionLength: number } };
      assert.equal(details.before, null); assert.equal(details.after.status, "draft"); assert.equal(details.after.descriptionLength, 11);
      assert.ok(!JSON.stringify(details).includes('"Description"'));
    });
    await t.test("partial update, explicit nulls and empty updates preserve omitted fields", async () => {
      const before = await get(id);
      const refs = await api.updateProduct(id, { brandId: data.brands[1]!.id, categoryId: data.categories[1]!.id, shortDescription: "Short" });
      assert.ok(refs.ok && refs.changed);
      assert.equal((await get(id)).brandId, data.brands[1]!.id); assert.equal((await get(id)).categoryId, data.categories[1]!.id);
      assert.ok((await api.updateProduct(id, { shortDescription: null })).ok);
      assert.equal((await get(id)).shortDescription, null);
      const r = await api.updateProduct(id, { name: "Updated", description: null }); assert.ok(r.ok && r.changed);
      const after = await get(id); assert.equal(after.name, "Updated"); assert.equal(after.description, null); assert.equal(after.slug, before.slug);
      assert.ok(after.updatedAt >= before.updatedAt);
      const audits = await count(); const timestamp = after.updatedAt;
      for (const patch of [{}, { name: undefined }, { name: "Updated" }]) {
        const noop = await api.updateProduct(id, patch); assert.ok(noop.ok); assert.equal(noop.changed, false);
      }
      assert.equal(await count(), audits); assert.deepEqual((await get(id)).updatedAt, timestamp);
      for (const patch of [{ brandId: null }, { name: null }, { status: null }, { actorId: "forged" }]) assert.equal((await api.updateProduct(id, patch)).ok, false);
      const rows = await db.select().from(schema.catalogAudit); const audit = rows.at(-1)!;
      const details = audit.changes as { fields: string[]; before: { name: string }; after: { name: string } };
      assert.equal(audit.action, "update"); assert.equal(audit.actorId, actorId); assert.equal(audit.productId, id);
      assert.deepEqual(details.fields, ["name", "description"]); assert.equal(details.before.name, "Test paddle"); assert.equal(details.after.name, "Updated");
    });
    await t.test("invalid and missing IDs, reference validation and unique constraint errors are safe", async () => {
      for (const productId of ["invalid", crypto.randomUUID()]) {
        for (const result of [await api.updateProduct(productId, {}), await api.archiveProduct(productId), await api.reactivateProduct(productId)]) {
          assert.ok(!result.ok); assert.equal(result.code, productId === "invalid" ? "VALIDATION" : "NOT_FOUND");
        }
      }
      const duplicate = await api.createProduct(input("Test Paddle")); assert.ok(!duplicate.ok); assert.equal(duplicate.code, "CONFLICT");
      for (const field of ["brandId", "categoryId"]) {
        for (const result of [await api.createProduct({ ...input(), [field]: crypto.randomUUID() }), await api.updateProduct(id, { [field]: crypto.randomUUID() })]) {
          assert.ok(!result.ok); assert.equal(result.code, "REFERENCE");
        }
      }
      const other = await api.createProduct(input()); assert.ok(other.ok);
      const collision = await api.updateProduct(other.productId, { slug: "test-paddle" }); assert.ok(!collision.ok); assert.equal(collision.code, "CONFLICT");
    });
    await t.test("archive and reactivate are idempotent, preserve active products on repeated reactivation", async () => {
      await api.updateProduct(id, { status: "active" });
      const audits = await count(); const activeNoop = await api.reactivateProduct(id); assert.ok(activeNoop.ok && !activeNoop.changed);
      assert.equal((await get(id)).status, "active"); assert.equal(await count(), audits);
      for (const [method, status] of [[api.archiveProduct, "archived"], [api.reactivateProduct, "draft"]] as const) {
        const first = await method(id); assert.ok(first.ok && first.changed); assert.equal((await get(id)).status, status);
        const before = await count(); const time = (await get(id)).updatedAt;
        const repeat = await method(id); assert.ok(repeat.ok && !repeat.changed); assert.equal(await count(), before); assert.deepEqual((await get(id)).updatedAt, time);
      }
      const logs = await db.select().from(schema.catalogAudit).where(eq(schema.catalogAudit.productId, id));
      assert.deepEqual(logs.slice(-2).map((l) => l.action), ["archive", "reactivate"]);
    });
    await t.test("stale/forged roles, inactive, expired, revoked and rebound sessions fail database rechecks", async () => {
      for (const reason of ["demoted", "inactive", "expired", "revoked", "rebound"] as const) {
        const identity = await f.signIn();
        const stale = createCatalogMutations({ change, authorize: async () => ({ ...identity, staff: { id: identity.user.id, active: true, role: "super_admin" } }) });
        if (reason === "demoted") await db.update(schema.user).set({ role: "staff" }).where(eq(schema.user.id, identity.user.id));
        if (reason === "inactive") await db.update(schema.user).set({ active: false }).where(eq(schema.user.id, identity.user.id));
        if (reason === "expired") await db.update(schema.session).set({ expiresAt: new Date(0) }).where(eq(schema.session.id, identity.session.id));
        if (reason === "revoked") await db.delete(schema.session).where(eq(schema.session.id, identity.session.id));
        if (reason === "rebound") { const other = await f.signIn(); await db.update(schema.session).set({ userId: other.user.id }).where(eq(schema.session.id, identity.session.id)); }
        const before = await count();
        for (const result of [await stale.createProduct(input()), await stale.updateProduct(id, { name: "Denied" }), await stale.archiveProduct(id), await stale.reactivateProduct(id)]) {
          assert.ok(!result.ok); assert.equal(result.code, "FORBIDDEN");
        }
        assert.equal(await count(), before);
        if (reason !== "rebound") {
          const normal = await api.createProduct(input()); assert.ok(!normal.ok); assert.equal(normal.code, "FORBIDDEN");
        }
      }
      await f.signIn();
    });
    await t.test("audit failure rolls back each mutation and mutation failure creates no audit", async () => {
      const before = await get(id); const audits = await count(); const products = await db.$count(schema.products);
      await client.exec("CREATE FUNCTION fail_catalog_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END; $$; CREATE TRIGGER fail_catalog_test BEFORE INSERT ON catalog_audit FOR EACH ROW EXECUTE FUNCTION fail_catalog_test();");
      for (const result of [await api.createProduct(input()), await api.updateProduct(id, { name: "Rollback" }), await api.archiveProduct(id)]) {
        assert.ok(!result.ok); assert.equal(result.code, "UNAVAILABLE"); assert.ok(!result.error.includes("fixture"));
      }
      assert.deepEqual(await get(id), before); assert.equal(await count(), audits); assert.equal(await db.$count(schema.products), products);
      await client.exec("DROP TRIGGER fail_catalog_test ON catalog_audit");
      await api.archiveProduct(id); const archived = await get(id); const next = await count();
      await client.exec("CREATE TRIGGER fail_catalog_test BEFORE INSERT ON catalog_audit FOR EACH ROW EXECUTE FUNCTION fail_catalog_test()");
      assert.equal((await api.reactivateProduct(id)).ok, false); assert.deepEqual(await get(id), archived); assert.equal(await count(), next);
      await client.exec("DROP TRIGGER fail_catalog_test ON catalog_audit");
      await client.exec("CREATE TRIGGER fail_catalog_product BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION fail_catalog_test()");
      assert.equal((await api.updateProduct(id, { name: "Fail" })).ok, false); assert.equal(await count(), next); assert.deepEqual(await get(id), archived);
      await client.exec("DROP TRIGGER fail_catalog_product ON products");
    });
    await t.test("overlapping requests preserve disjoint patches and slug uniqueness (adapter serializes)", async () => {
      const patches = await Promise.all([api.updateProduct(id, { name: "Concurrent name" }), api.updateProduct(id, { featured: true })]);
      assert.ok(patches.every((r) => r.ok)); const row = await get(id); assert.equal(row.name, "Concurrent name"); assert.equal(row.featured, true);
      const slug = `collision-${crypto.randomUUID()}`; const results = await Promise.all([api.createProduct(input(slug)), api.createProduct(input(slug))]);
      assert.equal(results.filter((r) => r.ok).length, 1); assert.ok(results.some((r) => !r.ok && r.code === "CONFLICT"));
    });
    await t.test("variants, balances, reservations and movement history are preserved; audits are append-only", async () => {
      const product = data.products[0]!;
      await client.query("SELECT inventory_apply($1::uuid,$2::uuid,$3::uuid,'OPENING_STOCK',10,'Catalog fixture','FIXTURE',null,$4)",
        [crypto.randomUUID(), data.variants[0]!.id, "00000000-0000-4000-8000-000000000001", (await f.signIn()).user.id]);
      await client.query("SELECT inventory_apply($1::uuid,$2::uuid,$3::uuid,'RESERVATION',2,'Catalog reservation','FIXTURE-ORDER',null,$4)",
        [crypto.randomUUID(), data.variants[0]!.id, "00000000-0000-4000-8000-000000000001", (await f.signIn()).user.id]);
      const snapshot = async () => Promise.all([db.select().from(schema.productVariants), db.select().from(schema.inventoryBalances), db.select().from(schema.inventoryReservations), db.select().from(schema.inventoryMovements)]);
      const before = await snapshot();
      assert.ok((await api.archiveProduct(product.id)).ok); assert.ok((await api.reactivateProduct(product.id)).ok);
      assert.ok((await api.updateProduct(product.id, { name: "Renamed" })).ok); assert.deepEqual(await snapshot(), before);
      for (const query of ["UPDATE catalog_audit SET action = 'update'", "DELETE FROM catalog_audit", "TRUNCATE catalog_audit"]) await assert.rejects(client.exec(query));
    });
  } finally { await client.close(); }
});
