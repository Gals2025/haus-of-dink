import assert from "node:assert/strict";
import { test } from "node:test";
import { productCreate, productUpdate, variantCreate, variantUpdate } from "../src/server/catalog/contracts";

const brandId = "11111111-1111-4111-8111-111111111111";
const categoryId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
const validProduct = { name: "Pickleball paddle", slug: "pickleball-paddle", brandId, categoryId };
const validVariant = { productId, sku: "HOD-PDL-001", price: 150000 };

test("product validation accepts valid payloads and rejects invalid values", () => {
  assert.equal(productCreate.parse(validProduct).status, "draft");
  assert.equal(productCreate.safeParse({ ...validProduct, slug: "Bad Slug" }).success, false);
  assert.equal(productCreate.safeParse({ ...validProduct, name: " " }).success, false);
  assert.equal(productCreate.safeParse({ ...validProduct, brandId: "invalid" }).success, false);
  assert.equal(productUpdate.safeParse({}).success, false);
  assert.equal(productUpdate.safeParse({ featured: true }).success, true);
});

test("variant validation rejects invalid SKU, barcode, money and currency", () => {
  assert.equal(variantCreate.parse(validVariant).currency, "PHP");
  for (const change of [
    { sku: " " }, { barcode: " " }, { price: -1 }, { price: 1.5 },
    { price: 2147483648 }, { currency: "php" },
    { compareAtPrice: 149999 }, { productId: "bad" },
  ]) assert.equal(variantCreate.safeParse({ ...validVariant, ...change }).success, false);
  assert.equal(variantUpdate.safeParse({}).success, false);
});

test("duplicate attribute values are rejected", () => {
  assert.equal(variantCreate.safeParse({ ...validVariant, attributeValueIds: [brandId, brandId] }).success, false);
  assert.equal(variantCreate.safeParse({ ...validVariant, attributeValueIds: [brandId, categoryId] }).success, true);
});


test("updates reject empty payloads and accept meaningful partial updates", () => {
  assert.equal(productUpdate.safeParse({}).success, false);
  assert.equal(productUpdate.safeParse({ featured: false }).success, true);
  assert.equal(variantUpdate.safeParse({}).success, false);
  assert.equal(variantUpdate.safeParse({ status: "inactive" }).success, true);
});

test("barcode rejects whitespace and untrimmed values", () => {
  for (const barcode of ["", " ", " A123", "A123 "]) {
    assert.equal(variantCreate.safeParse({ ...validVariant, barcode }).success, false);
  }
});
