import "server-only";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import { getPermissionSession } from "@/server/auth/authorize";
import { attributeValues, brands, categories, products } from "@/server/db/schema";
import { productCreate, variantCreate } from "./contracts";

export async function readCatalogPermission() {
  const identity = await getPermissionSession("inventory:read");
  if (!identity) throw new Error("Catalog read access denied.");
  return identity;
}

export async function writeCatalogPermission() {
  const identity = await getPermissionSession("inventory:write");
  if (!identity) throw new Error("Catalog write access denied.");
  return identity;
}

// Preflight only. Mutations MUST recheck permission in the same SQL statement
// that writes data, using currentPermissionSessionConditions and managementLock.
export async function validateProductReferences(input: unknown) {
  const parsed = productCreate.parse(input);
  await writeCatalogPermission();
  const db = getDb();
  const [brand] = await db.select({ id: brands.id, status: brands.status })
    .from(brands).where(eq(brands.id, parsed.brandId)).limit(1);
  const [category] = await db.select({ id: categories.id, status: categories.status })
    .from(categories).where(eq(categories.id, parsed.categoryId)).limit(1);
  if (!brand || brand.status !== "active" || !category || category.status !== "active") {
    throw new Error("An active brand and category are required.");
  }
  return parsed;
}

// Attribute values are validated against their owning attribute here;
// assigning them to a variant must be atomic with variant creation/update.
export async function validateVariantReferences(input: unknown) {
  const parsed = variantCreate.parse(input);
  await writeCatalogPermission();
  const db = getDb();
  const [product] = await db.select({ id: products.id, status: products.status })
    .from(products).where(eq(products.id, parsed.productId)).limit(1);
  if (!product || product.status === "archived") throw new Error("Product unavailable.");
  if (parsed.attributeValueIds.length) {
    const values = await db.select({
      id: attributeValues.id, attributeId: attributeValues.attributeId,
    }).from(attributeValues).where(inArray(attributeValues.id, parsed.attributeValueIds));
    if (values.length !== parsed.attributeValueIds.length ||
        new Set(values.map(v => v.attributeId)).size !== values.length) {
      throw new Error("Invalid or conflicting attribute values.");
    }
  }
  return parsed;
}
