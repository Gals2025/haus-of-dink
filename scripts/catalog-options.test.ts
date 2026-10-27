import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { catalogFixture } from "./catalog-fixture";
import { managementLock } from "../src/server/admin/queries";
import { createOptionMutations } from "../src/server/catalog/option-mutations";
import { createCatalogMutations, type MutationStorage } from "../src/server/catalog/mutations";

test("brand and category creation: validation, database authorization, conflicts and product use", async () => {
  const f = await catalogFixture(); const { db, client, schema } = f;
  const change: Parameters<typeof createOptionMutations>[0]["change"] = (query) => db.transaction(async (tx) => {
    await tx.execute(managementLock);
    return (await tx.execute<{ authorized: boolean; option: { id: string; name: string; status: string } | null }>(query)).rows[0];
  });
  const create = createOptionMutations({ authorize: f.storage.authorize, change });
  const input = { name: "New brand", slug: " New Brand! " };
  try {
    assert.deepEqual(await create("brand", input), { ok: false, code: "FORBIDDEN", error: "Access denied. Sign in with an authorized account." });
    await f.signIn("staff");
    assert.equal((await create("category", input)).ok, false);
    const identity = await f.signIn();
    for (const [kind, value] of [["anything", input], ["brand", { name: " ", slug: "x" }], ["category", { name: "x", slug: "!!!" }], ["brand", { ...input, status: "active" }], ["brand", { name: "x".repeat(161), slug: "x" }]]) {
      const result = await create(kind, value); assert.ok(!result.ok); assert.equal(result.code, "VALIDATION");
    }
    const brand = await create("brand", input); assert.ok(brand.ok); assert.equal(brand.option.status, "active");
    assert.equal((await db.select().from(schema.brands).where(eq(schema.brands.id, brand.option.id)))[0]?.slug, "new-brand");
    for (const value of [input, { name: "NEW BRAND", slug: "different-slug" }, { name: "Other brand", slug: "new-brand" }]) {
      const result = await create("brand", value); assert.ok(!result.ok); assert.equal(result.code, "CONFLICT");
    }
    const category = await create("category", { name: "New category", slug: "New Category" }); assert.ok(category.ok);
    const duplicate = await create("category", { name: "Another category", slug: "new-category" }); assert.ok(!duplicate.ok); assert.equal(duplicate.code, "CONFLICT");
    const productChange: MutationStorage["change"] = (query) => db.transaction(async (tx) => {
      await tx.execute(managementLock);
      return (await tx.execute<{ authorized: boolean; found: boolean; changed: boolean }>(query)).rows[0];
    });
    const products = createCatalogMutations({ authorize: f.storage.authorize, change: productChange });
    assert.ok((await products.createProduct({ name: "Option test", slug: "option-test", brandId: brand.option.id, categoryId: category.option.id })).ok);
    const stale = createOptionMutations({ authorize: async () => ({ ...identity, staff: { id: identity.user.id, role: "admin", active: true } }), change });
    await db.update(schema.user).set({ role: "staff" }).where(eq(schema.user.id, identity.user.id));
    for (const kind of ["brand", "category"]) {
      const denied = await stale(kind, { name: "Denied", slug: "denied" }); assert.ok(!denied.ok); assert.equal(denied.code, "FORBIDDEN");
    }
    assert.equal((await db.select().from(schema.brands).where(eq(schema.brands.slug, "denied"))).length, 0);
    await f.signIn();
    const failed = createOptionMutations({ authorize: f.storage.authorize, change: async () => { throw Error("private connection credentials"); } });
    const failure = await failed("brand", input); assert.ok(!failure.ok); assert.equal(failure.code, "UNAVAILABLE"); assert.ok(!failure.error.includes("credentials"));
  } finally { await client.close(); }
});
