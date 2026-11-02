"use server";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getPermissionSession } from "@/server/auth/authorize";
import { getDb } from "@/server/db";
import { brands, categories, products, productVariants, inventoryLocations, inventoryBalances } from "@/server/db/schema";
import { createProduct, updateProduct } from "@/server/catalog/mutations";
import { normalizeSlug } from "@/server/catalog/contracts";
import { createProductVariant, updateProductVariant } from "@/server/catalog/variant-mutations";
import { inventory } from "@/server/inventory/service";
import { mainLocationId } from "@/server/inventory/contracts";
import { parseCsv, productColumns, inventoryColumns } from "@/server/data-transfer/csv";

type Kind = "products" | "inventory";
type Parsed = { rows: Record<string, string>[]; errors: string[] };
function readCsv(text: string, kind: Kind): Parsed {
  try {
    if (text.length > 500_000) return { rows: [], errors: ["File exceeds the 500 KB limit."] };
    const csv = parseCsv(text);
    const expected = kind === "products" ? productColumns : inventoryColumns;
    const headers = csv.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
    if (headers.join("|") !== expected.join("|")) return { rows: [], errors: [`Template columns do not match. Download a fresh ${kind} template.`] };
    if (!csv.length) return { rows: [], errors: ["The template has no data rows."] };
    if (csv.length > 100) return { rows: [], errors: ["Upload up to 100 rows at a time."] };
    const errors: string[] = [];
    const rows = csv.map((values, index) => {
      if (values.length !== headers.length) errors.push(`Row ${index + 2}: expected ${headers.length} columns.`);
      return Object.fromEntries(headers.map((header, i) => [header, (values[i] ?? "").trim()]));
    });
    return { rows, errors };
  } catch { return { rows: [], errors: ["CSV parsing failed. Check quotes and separators."] }; }
}
export async function previewTransfer(kind: Kind, text: string) {
  if (kind !== "products" && kind !== "inventory") return { ok: false, errors: ["Invalid import type."], count: 0 };
  const identity = await getPermissionSession("inventory:write");
  if (!identity) return { ok: false, errors: ["Access denied."], count: 0 };
  const result = readCsv(text, kind);
  if (result.rows.length) {
    const seen = new Set<string>();
    result.rows.forEach((row, i) => {
      const get = (key: string) => row[key] ?? "";
      const line = i + 2;
      const required = kind === "products" ? ["product_slug", "product_name", "brand", "category", "sku", "price_cents"] : ["sku", "target_on_hand", "reason"];
      if (required.some((key) => !row[key])) result.errors.push(`Row ${line}: fill in all required columns.`);
      const unique = kind === "products" ? `${get("product_slug").toLowerCase()}|${get("sku").toLowerCase()}` : `${get("sku").toLowerCase()}|${get("location_id") || mainLocationId}`;
      if (seen.has(unique)) result.errors.push(`Row ${line}: duplicate product/SKU or SKU/location in this file.`);
      seen.add(unique);
      if (kind === "products" && (!/^\d+$/.test(get("price_cents")) || [get("compare_at_price_cents"), get("cost_cents")].some((v) => v && !/^\d+$/.test(v)))) result.errors.push(`Row ${line}: prices must be integer cents.`);
      if (kind === "inventory" && (!/^\d+$/.test(get("target_on_hand")) || get("reason").length < 3)) result.errors.push(`Row ${line}: target stock must be a whole number and reason at least 3 characters.`);
    });
  }
  return { ok: result.errors.length === 0, errors: result.errors, count: result.rows.length, text };
}

function truth(value: string) { return value === "true" || value === "1" || value === "yes"; }
function money(value: string) { if (!value) return null; const n = Number(value); return Number.isSafeInteger(n) && n >= 0 ? n : NaN; }
export async function commitTransfer(kind: Kind, text: string, batchId: string) {
  if ((kind !== "products" && kind !== "inventory") || !/^[0-9a-f-]{36}$/i.test(batchId)) return { ok: false, errors: ["Invalid import request. Upload the CSV again."], succeeded: 0, failed: 0 };
  const identity = await getPermissionSession("inventory:write");
  if (!identity) return { ok: false, errors: ["Access denied."], succeeded: 0, failed: 0 };
  const parsed = readCsv(text, kind);
  if (parsed.errors.length) return { ok: false, errors: parsed.errors, succeeded: 0, failed: 0 };
  const db = getDb(), errors: string[] = [];
  let succeeded = 0;
  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i] ?? {}, line = i + 2;
    const get = (key: string) => row[key] ?? "";
    try {
      if (kind === "products") {
        const required = ["product_slug", "product_name", "brand", "category", "sku", "price_cents"];
        if (required.some((key) => !row[key])) throw new Error("Product slug, name, brand, category, SKU and price are required.");
        const [brand] = await db.select().from(brands).where(sql`lower(${brands.name}) = lower(${get("brand")})`).limit(1);
        const [category] = await db.select().from(categories).where(sql`lower(${categories.name}) = lower(${get("category")})`).limit(1);
        if (!brand || !category) throw new Error("Brand or category was not found. Use existing active options.");
        const slug = normalizeSlug(get("product_slug"));
        const [existing] = await db.select().from(products).where(sql`lower(${products.slug}) = lower(${slug})`).limit(1);
        const price = money(get("price_cents")), compareAtPrice = money(get("compare_at_price_cents")), cost = money(get("cost_cents"));
        if (price === null || Number.isNaN(price) || Number.isNaN(compareAtPrice) || Number.isNaN(cost)) throw new Error("Prices must be nonnegative integer cents.");
        const productInput = { name: get("product_name"), slug, description: get("description") || null, shortDescription: get("short_description") || null, brandId: brand.id, categoryId: category.id, status: get("product_status") || "draft", featured: truth(get("featured")), newArrival: truth(get("new_arrival")) };
        const productResult = existing ? await updateProduct(existing.id, productInput) : await createProduct(productInput);
        if (!productResult.ok) throw new Error(productResult.error);
        const productId = productResult.productId;
        const variant = { productId, sku: get("sku"), barcode: get("barcode") || null, price, compareAtPrice, cost, currency: (get("currency") || "PHP").toUpperCase(), status: get("variant_status") || "active", attributeValueIds: [] };
        const [oldVariant] = await db.select().from(productVariants).where(sql`lower(${productVariants.sku}) = lower(${get("sku")})`).limit(1);
        const variantResult = oldVariant ? await updateProductVariant(oldVariant.id, variant) : await createProductVariant(variant);
        if (!variantResult.ok) throw new Error(variantResult.error);
      } else {
        if (!get("sku") || !/^\d+$/.test(get("target_on_hand")) || !get("reason") || get("reason").length < 3) throw new Error("SKU, whole target quantity and reason are required.");
        const [variant] = await db.select().from(productVariants).where(sql`lower(${productVariants.sku}) = lower(${get("sku")})`).limit(1);
        const locationId = get("location_id") || mainLocationId;
        const [location] = await db.select().from(inventoryLocations).where(eq(inventoryLocations.id, locationId)).limit(1);
        if (!variant || !location) throw new Error("SKU or location was not found.");
        const [balance] = await db.select().from(inventoryBalances).where(sql`${inventoryBalances.variantId} = ${variant.id} and ${inventoryBalances.locationId} = ${locationId}`).limit(1);
        const difference = Number(get("target_on_hand")) - (balance?.onHand ?? 0);
        if (difference !== 0) {
          const digest = createHash("sha256").update(`${batchId}:${i}`).digest("hex");
          const requestId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
          const result = await inventory.change({ requestId, variantId: variant.id, locationId, type: difference > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", quantity: Math.abs(difference), reason: get("reason"), reference: get("reference") || `CSV import row ${line}` });
          if (!result.ok) throw new Error(result.error);
        }
      }
      succeeded++;
    } catch (error) { errors.push(`Row ${line}: ${error instanceof Error ? error.message : "Import failed."}`); }
  }
  revalidatePath("/admin/products"); revalidatePath("/admin/inventory");
  return { ok: errors.length === 0, errors, succeeded, failed: errors.length };
}
