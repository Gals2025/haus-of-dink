import assert from "node:assert/strict";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { catalogFixture } from "./catalog-fixture";
import { managementLock } from "../src/server/admin/queries";
import { createVariantMutations } from "../src/server/catalog/variant-mutations";
import { createCatalogMutations } from "../src/server/catalog/mutations";
import { createInventory } from "../src/server/inventory/service";
import { stockQuery } from "../src/server/inventory/queries";
import { stockFilters, mainLocationId } from "../src/server/inventory/contracts";

test("product → SKU → stock receipt, validation, authorization and atomic audit", async () => {
  const f = await catalogFixture(); const { db, client, schema } = f;
  const change: Parameters<typeof createVariantMutations>[0]["change"] = (query) => db.transaction(async (tx) => {
    await tx.execute(managementLock);
    return (await tx.execute<{ authorized: boolean; found: boolean; eligible: boolean; variantId: string | null }>(query)).rows[0];
  });
  const create = createVariantMutations({ authorize: f.storage.authorize, change });
  let input = { productId: f.data.products[0]!.id, sku: "NEW-PINK", price: 15000, cost: 8000 };
  try {
    assert.equal((await create(input)).ok, false);
    await f.signIn("staff"); assert.equal((await create(input)).ok, false);
    const identity = await f.signIn();
    const products = createCatalogMutations({ authorize: f.storage.authorize, change: (query) => db.transaction(async (tx) => {
      await tx.execute(managementLock);
      return (await tx.execute<{ authorized: boolean; found: boolean; changed: boolean }>(query)).rows[0];
    }) });
    const product = await products.createProduct({ name: "Pink overgrip", slug: "pink-overgrip", brandId: f.data.brands[0]!.id, categoryId: f.data.categories[0]!.id });
    assert.ok(product.ok); input = { ...input, productId: product.productId };
    assert.equal((await db.execute(stockQuery(identity, stockFilters.parse({ search: "NEW-PINK" })))).rows.length, 0);
    for (const patch of [{ price: -1 }, { price: 0.5 }, { sku: " " }, { compareAtPrice: 1 }, { currency: "php" }, { actorId: "forged" }, { attributeValueIds: [crypto.randomUUID()] }]) {
      const result = await create({ ...input, ...patch }); assert.ok(!result.ok); assert.equal(result.code, "VALIDATION");
    }
    const missing = await create({ ...input, productId: crypto.randomUUID() }); assert.ok(!missing.ok); assert.equal(missing.code, "NOT_FOUND");
    const created = await create(input); assert.ok(created.ok);
    const [stored] = await db.select().from(schema.productVariants).where(eq(schema.productVariants.id, created.variantId));
    assert.equal(stored?.price, 15000); assert.equal(stored?.cost, 8000);
    const [stock] = (await db.execute(stockQuery(identity, stockFilters.parse({ search: "NEW-PINK" })))).rows;
    assert.equal(stock?.onHand, 0);
    const duplicate = await create({ ...input, sku: "new-pink" }); assert.ok(!duplicate.ok); assert.equal(duplicate.code, "CONFLICT");
    const withBarcode = await create({ ...input, sku: "BARCODE-A", barcode: "123456789" }); assert.ok(withBarcode.ok);
    const duplicateBarcode = await create({ ...input, sku: "BARCODE-B", barcode: "123456789" }); assert.ok(!duplicateBarcode.ok); assert.equal(duplicateBarcode.code, "CONFLICT");
    const inventory = createInventory({ authorize: f.storage.authorize, apply: (query) => db.transaction(async (tx) => {
      await tx.execute(managementLock); return (await tx.execute<{ id: string }>(query)).rows[0]?.id;
    }) });
    const receipt = { requestId: crypto.randomUUID(), variantId: created.variantId, locationId: mainLocationId, type: "PURCHASE", quantity: 10, reason: "New delivery", reference: "DR-001" };
    const received = await inventory.change(receipt); assert.ok(received.ok); assert.deepEqual(await inventory.change(receipt), received);
    const [after] = (await db.execute(stockQuery(identity, stockFilters.parse({ search: "NEW-PINK" })))).rows;
    assert.equal(after?.onHand, 10); assert.equal(after?.available, 10); assert.equal(await db.$count(schema.inventoryMovements), 1);
    const audits = await db.select().from(schema.catalogAudit);
    assert.ok(audits.some((a) => a.productId === input.productId && (a.changes as { variantId?: string }).variantId === created.variantId));
    await db.execute(sql`create function fail_variant_audit() returns trigger language plpgsql as $$ begin raise exception 'test audit failure'; end; $$`);
    await db.execute(sql`create trigger fail_variant_audit before insert on catalog_audit for each row execute function fail_variant_audit()`);
    const failed = await create({ ...input, sku: "ROLLBACK-SKU" }); assert.ok(!failed.ok); assert.equal(failed.code, "UNAVAILABLE");
    assert.equal(await db.$count(schema.productVariants, eq(schema.productVariants.sku, "ROLLBACK-SKU")), 0);
    await db.execute(sql`drop trigger fail_variant_audit on catalog_audit`);
    assert.ok((await products.archiveProduct(input.productId)).ok);
    assert.equal((await create({ ...input, sku: "ARCHIVED-SKU" })).ok, false);
    const stale = createVariantMutations({ authorize: async () => ({ ...identity, staff: { id: identity.user.id, role: "admin", active: true } }), change });
    await db.update(schema.user).set({ role: "staff" }).where(eq(schema.user.id, identity.user.id));
    const denied = await stale({ ...input, sku: "STALE-SKU" }); assert.ok(!denied.ok); assert.equal(denied.code, "FORBIDDEN");
  } finally { await client.close(); }
});
