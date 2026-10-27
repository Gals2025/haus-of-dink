import assert from "node:assert/strict";
import { test } from "node:test";
import { createProductInput, updateProductInput, productFilters, normalizeSlug } from "../src/server/catalog/contracts";
const valid = { name: "Paddle", slug: "  Café Paddle! ", brandId: crypto.randomUUID(), categoryId: crypto.randomUUID() };
test("product contracts normalize slugs and default safe values", () => {
  assert.equal(normalizeSlug(valid.slug), "cafe-paddle");
  assert.deepEqual(createProductInput.parse(valid), { ...valid, slug: "cafe-paddle", status: "draft", featured: false, newArrival: false });
  assert.equal(productFilters.parse({}).pageSize, 20);
  for (const input of [{ ...valid, name: " " }, { ...valid, slug: "!" }, { ...valid, brandId: null },
    { ...valid, categoryId: "bad" }, { ...valid, status: "published" }, { ...valid, featured: "yes" },
    { ...valid, actorId: "forged" }, { ...valid, shortDescription: "x".repeat(501) }]) assert.equal(createProductInput.safeParse(input).success, false);
});
test("partial updates preserve omission and accept null only on descriptions", () => {
  assert.deepEqual(updateProductInput.parse({}), {});
  assert.deepEqual(updateProductInput.parse({ name: undefined, description: null }), { description: null });
  for (const field of ["name", "slug", "brandId", "categoryId", "status", "featured", "newArrival"]) {
    assert.equal(updateProductInput.safeParse({ [field]: null }).success, false);
  }
  assert.equal(updateProductInput.safeParse({ role: "admin" }).success, false);
  assert.equal(productFilters.safeParse({ sort: "name; drop table products" }).success, false);
  assert.equal(productFilters.safeParse({ page: 0 }).success, false);
});
