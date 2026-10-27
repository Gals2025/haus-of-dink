import assert from "node:assert/strict";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { catalogFixture } from "./catalog-fixture";
import { managementLock } from "../src/server/admin/queries";
import { createCatalogManagement, type ManagementDeps } from "../src/server/catalog/management";
import { createVariantMutations } from "../src/server/catalog/variant-mutations";
import { createCatalogMutations } from "../src/server/catalog/mutations";
import { createVariantReads } from "../src/server/catalog/variant-reads";
import { createCatalogReads } from "../src/server/catalog/service";
import { mainLocationId } from "../src/server/inventory/contracts";
import { createInventory } from "../src/server/inventory/service";

async function fixture() {
  const f = await catalogFixture();
  const change: ManagementDeps["change"] = (query) => f.db.transaction(async (tx) => {
    await tx.execute(managementLock);
    return (await tx.execute<{ authorized: boolean; found: boolean; eligible: boolean; changed: boolean }>(query)).rows[0];
  });
  return { ...f, management: createCatalogManagement({ ...f.storage, change }), change };
}

test("catalog management validates references, ancestry, ownership, authorization and append-only audit", async () => {
  const f = await fixture(); const { management: m, db, schema } = f;
  try {
    assert.equal((await m.list()).ok, false);
    assert.equal((await m.history()).ok, false);
    assert.equal((await m.save("brand", null, { name: "Denied", slug: "denied" })).ok, false);
    await f.signIn("staff");
    assert.ok((await m.list()).ok);
    assert.equal((await m.remove("brand", f.data.brands[0]!.id)).ok, false);
    const identity = await f.signIn();
    for (const input of [{ name: " ", slug: "x" }, { name: "Bad URL", slug: "bad-url", websiteUrl: "javascript:alert(1)" }, { name: "Bad URL", slug: "bad-url", logoUrl: "http://example.test/a.png" }, { name: "Bad", slug: "bad", actorId: identity.user.id }]) {
      const result = await m.save("brand", null, input); assert.ok(!result.ok); assert.equal(result.code, "VALIDATION");
    }
    const brand = await m.save("brand", null, { name: "Managed Brand", slug: " Managed Brand! ", websiteUrl: "https://example.test", logoUrl: "https://example.test/logo.png" }); assert.ok(brand.ok);
    const duplicate = await m.save("brand", null, { name: "MANAGED BRAND", slug: "another" }); assert.ok(!duplicate.ok); assert.equal(duplicate.code, "CONFLICT");
    assert.ok((await m.save("brand", brand.id, { name: "Renamed", slug: "renamed", status: "inactive", description: "New description" })).ok);
    const list = await m.list(); assert.ok(list.ok);
    assert.equal(list.brands.find((b) => b.id === brand.id)?.status, "inactive");
    const root = await m.save("category", null, { name: "Root", slug: "root" }); assert.ok(root.ok);
    const child = await m.save("category", null, { name: "Child", slug: "child", parentId: root.id }); assert.ok(child.ok);
    for (const parentId of [root.id, child.id, crypto.randomUUID()]) {
      const result = await m.save("category", root.id, { name: "Root", slug: "root", parentId }); assert.ok(!result.ok); assert.equal(result.code, "REFERENCE");
    }
    assert.equal((await m.remove("category", root.id)).ok, false);
    assert.equal((await m.remove("brand", f.data.brands[0]!.id)).ok, false);
    const attr = await m.save("attribute", null, { name: "Color", slug: "color" }); assert.ok(attr.ok);
    const value = await m.save("value", null, { value: "Pink", slug: "pink", attributeId: attr.id }); assert.ok(value.ok);
    const other = await m.save("attribute", null, { name: "Size", slug: "size" }); assert.ok(other.ok);
    const reparent = await m.save("value", value.id, { value: "Pink", slug: "pink", attributeId: other.id }); assert.ok(!reparent.ok); assert.equal(reparent.code, "REFERENCE");
    assert.equal((await m.remove("attribute", attr.id)).ok, false);
    assert.ok((await m.remove("value", value.id)).ok);
    assert.ok((await m.remove("attribute", attr.id)).ok);
    assert.ok((await m.remove("category", child.id)).ok);
    assert.ok((await m.remove("category", root.id)).ok);
    assert.ok((await m.remove("brand", brand.id)).ok);
    const history = await m.history(); assert.ok(history.ok);
    assert.ok(history.entries.some((e) => e.entityId === brand.id && e.action === "delete"));
    await assert.rejects(db.execute(sql`delete from catalog_management_audit`));
    await assert.rejects(db.execute(sql`truncate catalog_management_audit`));
    const stale = createCatalogManagement({ ...f.storage, authorize: async () => ({ ...identity, staff: { id: identity.user.id, role: "admin", active: true } }), change: f.change });
    await db.update(schema.user).set({ role: "staff" }).where(eq(schema.user.id, identity.user.id));
    const denied = await stale.save("brand", null, { name: "Revoked", slug: "revoked" }); assert.ok(!denied.ok); assert.equal(denied.code, "FORBIDDEN");
    await f.signIn();
    await db.execute(sql`create function fail_management_audit() returns trigger language plpgsql as $$ begin raise exception 'test audit failure'; end; $$`);
    await db.execute(sql`create trigger fail_management_audit before insert on catalog_management_audit for each row execute function fail_management_audit()`);
    assert.equal((await m.save("brand", null, { name: "Rollback", slug: "rollback" })).ok, false);
    assert.equal(await db.$count(schema.brands, eq(schema.brands.slug, "rollback")), 0);
    const existingBrand = f.data.brands[0]!;
    assert.equal((await m.save("brand", existingBrand.id, { name: "Rollback edit", slug: existingBrand.slug })).ok, false);
    assert.equal((await db.select().from(schema.brands).where(eq(schema.brands.id, existingBrand.id!)))[0]?.name, existingBrand.name);
    assert.equal((await m.remove("attribute", other.id)).ok, false);
    assert.equal(await db.$count(schema.attributes, eq(schema.attributes.id, other.id)), 1);
  } finally { await f.client.close(); }
});

test("variant edits assign attributes atomically, reject duplicate combinations and preserve inventory history", async () => {
  const f = await fixture(); const { db, schema, management: m } = f;
  const mutate = createVariantMutations({ authorize: f.storage.authorize, change: (query) => db.transaction(async (tx) => {
    await tx.execute(managementLock);
    return (await tx.execute<{ authorized: boolean; found: boolean; eligible: boolean; variantId: string | null; validAttributes: boolean; duplicate: boolean }>(query)).rows[0];
  }) });
  const products = createCatalogMutations({ authorize: f.storage.authorize, change: f.change });
  try {
    await f.signIn();
    const product = await products.createProduct({ name: "Variant managed", slug: "variant-managed", brandId: f.data.brands[0]!.id, categoryId: f.data.categories[0]!.id }); assert.ok(product.ok);
    const color = await m.save("attribute", null, { name: "Color", slug: "color" }); assert.ok(color.ok);
    const pink = await m.save("value", null, { value: "Pink", slug: "pink", attributeId: color.id }); assert.ok(pink.ok);
    const blue = await m.save("value", null, { value: "Blue", slug: "blue", attributeId: color.id }); assert.ok(blue.ok);
    const input = { productId: product.productId, sku: "MANAGED-PINK", price: 15000, cost: 8000, attributeValueIds: [pink.id] };
    const created = await mutate(input); assert.ok(created.ok);
    const variants = createVariantReads(f.storage);
    const listed = await variants({ search: "MANAGED-PINK", page: 1 }); assert.ok(listed.ok);
    assert.equal(listed.total, 1); assert.equal(listed.rows[0]?.options, "Color: Pink");
    const beyond = await variants({ search: "MANAGED-PINK", page: 2 }); assert.ok(beyond.ok); assert.equal(beyond.total, 1); assert.equal(beyond.rows.length, 0);
    const escaped = await variants({ search: "%" }); assert.ok(escaped.ok); assert.equal(escaped.total, 0);
    assert.equal((await variants({ status: "invalid" })).ok, false);
    const duplicate = await mutate({ ...input, sku: "DUPLICATE" }); assert.ok(!duplicate.ok); assert.equal(duplicate.code, "CONFLICT");
    const conflicting = await mutate({ ...input, sku: "BAD", attributeValueIds: [pink.id, blue.id] }); assert.ok(!conflicting.ok); assert.equal(conflicting.code, "VALIDATION");
    assert.equal((await m.remove("value", pink.id)).ok, false);
    assert.ok((await mutate({ ...input, sku: "MANAGED-BLUE", price: 17000, cost: null, barcode: "555", attributeValueIds: [blue.id] }, created.variantId)).ok);
    let detail = await createCatalogReads(f.storage).getProductDetail(product.productId); assert.ok(detail.ok);
    assert.equal(detail.product.variants[0]?.attributes[0]?.value, "Blue");
    assert.equal(detail.product.variants[0]?.cost, null);
    // Replacement uses the same attribute without leaving a stale old mapping.
    assert.equal(await db.$count(schema.productAttributeValues, eq(schema.productAttributeValues.variantId, created.variantId)), 1);
    assert.ok((await mutate({ ...input, sku: "MANAGED-BLUE", attributeValueIds: [], status: "inactive" }, created.variantId)).ok);
    detail = await createCatalogReads(f.storage).getProductDetail(product.productId); assert.ok(detail.ok);
    assert.equal(detail.product.variants[0]?.attributes.length, 0);
    assert.equal(detail.product.variants[0]?.status, "inactive");
    assert.ok((await mutate({ ...input, attributeValueIds: [] }, created.variantId)).ok);
    const inventory = createInventory({ authorize: f.storage.authorize, apply: (query) => db.transaction(async (tx) => {
      await tx.execute(managementLock); return (await tx.execute<{ id: string }>(query)).rows[0]?.id;
    }) });
    assert.ok((await inventory.change({ requestId: crypto.randomUUID(), variantId: created.variantId, locationId: mainLocationId, type: "PURCHASE", quantity: 2, reason: "Test receipt", reference: "T-1" })).ok);
    const protectedDelete = await mutate({ productId: product.productId }, created.variantId, true); assert.ok(!protectedDelete.ok);
    assert.equal(await db.$count(schema.inventoryMovements), 1);
    const unused = await mutate({ ...input, sku: "UNUSED", attributeValueIds: [] }); assert.ok(unused.ok);
    // Reorder setup may create a zero balance even without stock history.
    await db.insert(schema.inventoryBalances).values({ variantId: unused.variantId, locationId: mainLocationId, onHand: 0, reserved: 0 });
    assert.ok((await mutate({ productId: product.productId }, unused.variantId, true)).ok);
    assert.equal(await db.$count(schema.productVariants, eq(schema.productVariants.id, unused.variantId)), 0);
    assert.equal(await db.$count(schema.inventoryBalances, eq(schema.inventoryBalances.variantId, unused.variantId)), 0);
    const mismatched = await mutate(input, f.data.variants[0]!.id); assert.ok(!mismatched.ok); assert.equal(mismatched.code, "NOT_FOUND");
    await db.execute(sql`create function fail_edit_audit() returns trigger language plpgsql as $$ begin raise exception 'test audit failure'; end; $$`);
    await db.execute(sql`create trigger fail_edit_audit before insert on catalog_audit for each row execute function fail_edit_audit()`);
    assert.equal((await mutate({ ...input, sku: "ROLLBACK", attributeValueIds: [pink.id] }, created.variantId)).ok, false);
    detail = await createCatalogReads(f.storage).getProductDetail(product.productId); assert.ok(detail.ok);
    assert.equal(detail.product.variants[0]?.sku, "MANAGED-PINK");
    assert.equal(detail.product.variants[0]?.attributes.length, 0);
    assert.equal(await db.$count(schema.inventoryMovements), 1);
    await db.execute(sql`drop trigger fail_edit_audit on catalog_audit`);
    const inactiveBrand = await m.save("brand", null, { name: "Inactive", slug: "inactive", status: "inactive" }); assert.ok(inactiveBrand.ok);
    const invalidReference = await products.updateProduct(product.productId, { brandId: inactiveBrand.id }); assert.ok(!invalidReference.ok); assert.equal(invalidReference.code, "REFERENCE");
    assert.ok((await m.save("brand", f.data.brands[0]!.id, { name: f.data.brands[0]!.name, slug: f.data.brands[0]!.slug, status: "inactive" })).ok);
    assert.ok((await products.updateProduct(product.productId, { name: "Preserved old brand", brandId: f.data.brands[0]!.id })).ok);
    await f.signIn("staff");
    const denied = await mutate(input, created.variantId); assert.ok(!denied.ok); assert.equal(denied.code, "FORBIDDEN");
  } finally { await f.client.close(); }
});
