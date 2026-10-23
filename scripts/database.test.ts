import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import * as schema from "../src/server/db/schema";
import { developmentCatalog as data } from "./seed-data";

// Real PostgreSQL semantics in an isolated in-memory instance; no credentials.
test("catalog migrations, fixtures, and database invariants", async (t) => {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  try {
    await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
    await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
    async function seed() {
      await db.transaction(async (tx) => {
        await tx.insert(schema.brands).values(data.brands).onConflictDoNothing({ target: schema.brands.id });
        await tx.insert(schema.categories).values(data.categories).onConflictDoNothing({ target: schema.categories.id });
        await tx.insert(schema.attributes).values(data.attributes).onConflictDoNothing({ target: schema.attributes.id });
        await tx.insert(schema.attributeValues).values(data.attributeValues).onConflictDoNothing({ target: schema.attributeValues.id });
        await tx.insert(schema.products).values(data.products).onConflictDoNothing({ target: schema.products.id });
        await tx.insert(schema.productVariants).values(data.variants).onConflictDoNothing({ target: schema.productVariants.id });
        await tx.insert(schema.productAttributeValues).values(data.assignments).onConflictDoNothing({ target: schema.productAttributeValues.id });
      });
    }
    await seed();
    await seed();
    const [product, otherProduct] = data.products;
    const [variant] = data.variants;
    const [attribute, otherAttribute] = data.attributes;
    const [value] = data.attributeValues;
    assert.ok(product && otherProduct && variant && attribute && otherAttribute && value);

    await t.test("seeding and migration reruns are idempotent", async () => {
      assert.equal(await db.$count(schema.brands), 5);
      assert.equal(await db.$count(schema.categories), 6);
      assert.equal(await db.$count(schema.products), 7);
      assert.equal(await db.$count(schema.productVariants), 9);
      assert.equal(await db.$count(schema.productAttributeValues), 15);
    });
    await t.test("relations resolve products, variants, specifications, and brand", async () => {
      const found = await db.query.products.findFirst({
        where: (p, { eq }) => eq(p.id, product.id),
        with: { brand: true, variants: { with: { attributeValues: { with: { value: true } } } }, attributeValues: true },
      });
      assert.equal(found?.brand.name, "JOOLA");
      assert.equal(found?.variants.length, 2);
      assert.ok(found?.variants.every((v) => v.attributeValues[0]?.value));
    });
    await t.test("money is integer minor units with valid compare-at and cost", async () => {
      for (const invalid of [{ price: -1 }, { price: 1.5 }, { cost: -1 }, { compareAtPrice: variant.price - 1 }]) {
        await assert.rejects(db.insert(schema.productVariants).values({ ...variant, id: undefined, sku: "INVALID-MONEY", ...invalid }));
      }
    });
    await t.test("SKU uniqueness ignores case; nullable barcodes remain allowed", async () => {
      await assert.rejects(db.insert(schema.productVariants).values({ ...variant, id: undefined, sku: variant.sku.toLowerCase() }));
      await db.insert(schema.productVariants).values({ ...variant, id: undefined, sku: "BARCODE-1", barcode: "0123456789012" });
      await assert.rejects(db.insert(schema.productVariants).values({ ...variant, id: undefined, sku: "BARCODE-2", barcode: "0123456789012" }));
    });
    await t.test("invalid product references, duplicate slugs, and invalid statuses fail", async () => {
      await assert.rejects(db.insert(schema.products).values({ ...product, id: undefined }));
      await assert.rejects(db.insert(schema.products).values({ ...product, id: undefined, slug: "invalid-brand", brandId: "00000000-0000-4000-8000-000000000000" }));
      await assert.rejects(client.exec("UPDATE products SET status = 'unknown'"));
    });
    const image = { productId: product.id, blobUrl: "https://example.public.blob.vercel-storage.com/paddle.webp", altText: "Development paddle image", isPrimary: true };
    await t.test("primary images are unique per product or variant scope", async () => {
      await db.insert(schema.productImages).values(image);
      await assert.rejects(db.insert(schema.productImages).values(image));
      await db.insert(schema.productImages).values({ ...image, variantId: variant.id });
      await assert.rejects(db.insert(schema.productImages).values({ ...image, variantId: variant.id }));
      await db.insert(schema.productImages).values({ ...image, isPrimary: false, sortOrder: 1 });
    });
    await t.test("images cannot reference a different product's variant", async () => {
      await assert.rejects(db.insert(schema.productImages).values({ ...image, productId: otherProduct.id, variantId: variant.id }));
    });
    await t.test("image URLs, alt text, and ordering are checked", async () => {
      for (const invalid of [{ blobUrl: "http://example.com/image.png" }, { altText: " " }, { sortOrder: -1 }]) {
        await assert.rejects(db.insert(schema.productImages).values({ ...image, isPrimary: false, ...invalid }));
      }
    });
    await t.test("attribute values must belong to the stated attribute and product", async () => {
      await assert.rejects(db.insert(schema.productAttributeValues).values({ productId: product.id, attributeId: otherAttribute.id, attributeValueId: value.id }));
      await assert.rejects(db.insert(schema.productAttributeValues).values({ productId: otherProduct.id, variantId: variant.id, attributeId: attribute.id, attributeValueId: value.id }));
    });
    await t.test("duplicate product specs and multiple values for one variant attribute fail", async () => {
      const [assignment] = data.assignments;
      assert.ok(assignment);
      await assert.rejects(db.insert(schema.productAttributeValues).values({ ...assignment, id: undefined }));
      const spec = data.assignments.find((a) => a.variantId === null);
      assert.ok(spec);
      await assert.rejects(db.insert(schema.productAttributeValues).values({ ...spec, id: undefined }));
    });
    await t.test("category hierarchy rejects self-parenting and indirect cycles", async () => {
      const [root] = data.categories;
      assert.ok(root);
      await assert.rejects(db.update(schema.categories).set({ parentId: root.id }).where(sql`${schema.categories.id} = ${root.id}`));
      const [child] = await db.insert(schema.categories).values({ name: "Test Child", slug: "test-child", parentId: root.id }).returning();
      assert.ok(child);
      await assert.rejects(db.update(schema.categories).set({ parentId: child.id }).where(sql`${schema.categories.id} = ${root.id}`));
    });
    await t.test("timestamps update even when bypassing Drizzle", async () => {
      const result = await client.query<{ created_at: Date; updated_at: Date }>(
        "UPDATE products SET updated_at = '2000-01-01', name = name WHERE id = $1 RETURNING created_at, updated_at", [product.id],
      );
      assert.ok(new Date(result.rows[0]!.updated_at).getFullYear() > 2000);
    });
    await t.test("referenced brands and values are protected; product children cascade", async () => {
      await assert.rejects(db.delete(schema.brands).where(sql`${schema.brands.id} = ${product.brandId}`));
      await assert.rejects(db.delete(schema.attributeValues).where(sql`${schema.attributeValues.id} = ${value.id}`));
      await db.delete(schema.products).where(sql`${schema.products.id} = ${product.id}`);
      assert.equal(await db.$count(schema.productVariants, sql`${schema.productVariants.productId} = ${product.id}`), 0);
      assert.equal(await db.$count(schema.productImages, sql`${schema.productImages.productId} = ${product.id}`), 0);
      assert.equal(await db.$count(schema.productAttributeValues, sql`${schema.productAttributeValues.productId} = ${product.id}`), 0);
    });
  } finally {
    await client.close();
  }
});
