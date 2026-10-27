import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { catalogFixture } from "./catalog-fixture";
import { createCatalogReads } from "../src/server/catalog/service";
import { listProductsQuery } from "../src/server/catalog/queries";
import { productFilters } from "../src/server/catalog/contracts";

test("Phase 2A reads use isolated PostgreSQL and current authorization", async (t) => {
  const f = await catalogFixture(); const { db, schema, data } = f;
  const api = createCatalogReads(f.storage);
  try {
    assert.deepEqual(await api.listProducts(), { ok: false, code: "FORBIDDEN", error: "Access denied. Sign in with an authorized account." });
    const identity = await f.signIn("staff");
    await t.test("pagination, totals, filtering, searching and deterministic sorting", async () => {
      for (let i = 0; i < 22; i++) await db.insert(schema.products).values({ ...data.products[0]!, id: undefined,
        name: `Paged ${i.toString().padStart(2, "0")}`, slug: `paged-${i}`, featured: true, newArrival: true, status: "draft" });
      const first = await api.listProducts({ search: "Paged", sort: "name_asc" });
      assert.ok(first.ok); assert.equal(first.products.length, 20); assert.equal(first.total, 22); assert.equal(first.totalPages, 2);
      assert.equal(first.products[0]!.name, "Paged 00");
      const second = await api.listProducts({ search: "Paged", page: 2, sort: "name_asc" });
      assert.ok(second.ok); assert.equal(second.products.length, 2);
      const beyond = await api.listProducts({ search: "Paged", page: 9 });
      assert.ok(beyond.ok); assert.equal(beyond.products.length, 0); assert.equal(beyond.total, 22);
      const filters = { search: "Paged", brandId: data.products[0]!.brandId, categoryId: data.products[0]!.categoryId, status: "draft", featured: true, newArrival: true, sort: "name_desc" };
      const filtered = await api.listProducts(filters); assert.ok(filtered.ok); assert.equal(filtered.total, 22); assert.equal(filtered.products[0]!.name, "Paged 21");
      for (const search of ["%' OR true --", "%", "_"]) { const r = await api.listProducts({ search }); assert.ok(r.ok); assert.equal(r.total, 0); }
      for (const sort of ["oldest", "newest"]) assert.ok((await api.listProducts({ sort })).ok);
    });
    await t.test("detail includes variants and images; invalid and missing IDs are safe", async () => {
      await db.insert(schema.productImages).values({ productId: data.products[0]!.id, blobUrl: "https://example.test/paddle.png", altText: "Paddle" });
      const r = await api.getProductDetail(data.products[0]!.id); assert.ok(r.ok);
      assert.equal(r.product.variants.length, 2); assert.equal(r.product.images.length, 1);
      assert.equal((await api.getProductDetail("bad" )).ok, false);
      assert.deepEqual((await api.getProductDetail(crypto.randomUUID())), { ok: false, code: "NOT_FOUND", error: "Product not found." });
    });
    await t.test("database boundary rejects inactive or revoked session even with stale identity", async () => {
      await db.update(schema.user).set({ active: false }).where(eq(schema.user.id, identity.user.id));
      const [row] = await f.storage.read<{ authorized: boolean }>(listProductsQuery(identity, productFilters.parse({})));
      assert.equal(row?.authorized, false); assert.equal((await api.listProducts()).ok, false);
      await db.update(schema.user).set({ active: true }).where(eq(schema.user.id, identity.user.id));
      await db.delete(schema.session).where(eq(schema.session.id, identity.session.id));
      assert.equal((await api.listProducts()).ok, false);
    });
  } finally { await f.client.close(); }
});
