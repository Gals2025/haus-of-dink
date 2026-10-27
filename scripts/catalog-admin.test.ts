import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { parseProductSearch, productPageHref, changedProductFields } from "../src/server/catalog/admin-input";
import { createProductAdminActions } from "../src/server/catalog/admin-actions";
import { createCatalogReads } from "../src/server/catalog/service";
import { createCatalogMutations } from "../src/server/catalog/mutations";
import { productOptionsQuery } from "../src/server/catalog/queries";
import { managementLock } from "../src/server/admin/queries";
import { catalogFixture } from "./catalog-fixture";
import type { ProductInput, Product } from "../src/server/catalog/contracts";

const input: ProductInput = { name: "Form product", slug: "form-product", brandId: crypto.randomUUID(), categoryId: crypto.randomUUID(),
  description: "Original", shortDescription: null, status: "draft", featured: true, newArrival: false };

test("admin query parsing rejects crafted filters and preserves filters across pagination", () => {
  const result = parseProductSearch({ page: "2", status: "draft", featured: "false", newArrival: "true", search: "Paddle", sort: "name_desc" });
  assert.ok(result.success); assert.equal(result.data.page, 2); assert.equal(result.data.featured, false);
  assert.equal(result.data.pageSize, 20); assert.equal(result.data.newArrival, true);
  for (const params of [{ page: "-1" }, { page: ["2", "3"] }, { page: ["2"] }, { featured: "yes" }, { status: "owner" }, { search: ["x"] }, { brandId: "bad" }, { sort: "drop table" }]) {
    assert.equal(parseProductSearch(params).success, false);
  }
  const url = new URL(productPageHref({ search: "100% & paddles", featured: "false", status: "archived", sort: "name_desc", actorId: "forged" }, 3), "https://example.test");
  assert.equal(url.searchParams.get("search"), "100% & paddles"); assert.equal(url.searchParams.get("page"), "3");
  assert.equal(url.searchParams.get("featured"), "false"); assert.equal(url.searchParams.get("actorId"), null);
});

test("edit payload sends only changes, including false flags and explicit description clearing", () => {
  assert.deepEqual(changedProductFields(input, { ...input }), {});
  assert.deepEqual(changedProductFields(input, { ...input, featured: false, description: null }), { description: null, featured: false });
});

test("admin action boundary and options execute against isolated PostgreSQL", async (t) => {
  const f = await catalogFixture(); const { db, schema } = f;
  const reads = createCatalogReads(f.storage);
  const writes = createCatalogMutations({ authorize: f.storage.authorize, change: (query) => db.transaction(async (tx) => {
    await tx.execute(managementLock);
    return (await tx.execute<{ authorized: boolean; found: boolean; changed: boolean }>(query)).rows[0];
  }) });
  const refreshed: string[] = [];
  const actions = createProductAdminActions({ ...writes, authorize: f.storage.authorize,
    create: writes.createProduct, update: writes.updateProduct, archive: writes.archiveProduct, reactivate: writes.reactivateProduct,
    refresh: (id) => { refreshed.push(id); },
  });
  let id: string;
  try {
    await t.test("signed-out and read-only staff cannot invoke actions; options require read permission", async () => {
      assert.equal((await reads.listProductOptions()).ok, false);
      for (const signedIn of [false, true]) {
        if (signedIn) await f.signIn("staff");
        for (const result of [await actions.create(input), await actions.update(f.data.products[0]!.id, { name: "Denied" }),
          await actions.archive(f.data.products[0]!.id), await actions.reactivate(f.data.products[0]!.id)]) {
          assert.ok(!result.ok); assert.equal(result.code, "FORBIDDEN");
        }
      }
      const options = await reads.listProductOptions(); assert.ok(options.ok);
      assert.equal(options.brands.length, f.data.brands.length); assert.equal(options.categories.length, f.data.categories.length);
      assert.deepEqual(Object.keys(options.brands[0]!).sort(), ["id", "name", "status"]);
      assert.equal(refreshed.length, 0); assert.equal(await db.$count(schema.catalogAudit), 0);
    });
    await t.test("authorized create, edited-field update and status actions refresh after successful writes", async () => {
      await f.signIn("admin");
      const created = await actions.create({ ...input, brandId: f.data.brands[0]!.id, categoryId: f.data.categories[0]!.id });
      assert.ok(created.ok); id = created.productId; assert.deepEqual(refreshed, [id]);
      const detail = await reads.getProductDetail(id); assert.ok(detail.ok);
      const original: Product = detail.product;
      // Another editor changes a field the first editor did not touch.
      assert.ok((await writes.updateProduct(id, { featured: false })).ok);
      assert.ok((await actions.update(id, changedProductFields(original, { ...original, name: "Edited" }))).ok);
      const updated = await reads.getProductDetail(id); assert.ok(updated.ok);
      assert.equal(updated.product.name, "Edited"); assert.equal(updated.product.featured, false);
      assert.ok((await actions.archive(id)).ok); assert.ok((await actions.reactivate(id)).ok);
      const restored = await reads.getProductDetail(id); assert.ok(restored.ok); assert.equal(restored.product.status, "draft");
      assert.equal(refreshed.length, 4);
    });
    await t.test("invalid IDs and slug conflicts return safe results and do not refresh", async () => {
      const before = refreshed.length;
      assert.equal((await actions.update("not-a-uuid", { name: "Test" })).ok, false);
      const duplicate = await actions.create({ ...input, brandId: f.data.brands[0]!.id, categoryId: f.data.categories[0]!.id });
      assert.ok(!duplicate.ok); assert.equal(duplicate.code, "CONFLICT"); assert.equal(refreshed.length, before);
    });
    await t.test("options SQL rechecks revoked identity; inactive accounts cannot use actions", async () => {
      const identity = await f.signIn();
      await db.update(schema.user).set({ active: false }).where(eq(schema.user.id, identity.user.id));
      const [row] = await f.storage.read<{ authorized: boolean; brands: unknown[]; categories: unknown[] }>(productOptionsQuery(identity));
      assert.equal(row?.authorized, false); assert.deepEqual(row?.brands, []); assert.deepEqual(row?.categories, []);
      assert.equal((await actions.archive(id)).ok, false); assert.equal((await reads.listProductOptions()).ok, false);
    });
  } finally { await f.client.close(); }
});

test("unit: refresh failures preserve a confirmed successful result; exceptions are sanitized", async () => {
  const success = { ok: true as const, productId: crypto.randomUUID(), changed: true };
  let creates = 0;
  const deps = { authorize: async () => ({}) as never, create: async () => { creates++; return success; }, update: async () => success,
    archive: async () => success, reactivate: async () => success, refresh: () => { throw Error("private cache detail"); } };
  const api = createProductAdminActions(deps);
  assert.deepEqual(await api.create({}), success); assert.equal(creates, 1);
  const broken = createProductAdminActions({ ...deps, create: async () => { throw Error("private database detail"); } });
  const result = await broken.create({}); assert.ok(!result.ok); assert.equal(result.code, "UNAVAILABLE");
  assert.ok(!result.error.includes("private"));
});
