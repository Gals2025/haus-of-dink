import { z } from "zod";

export const productId = z.uuid();
export const productStatus = z.enum(["draft", "active", "archived"]);
export function normalizeSlug(value: string) {
  return value.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
const slug = z.string().max(1040).transform(normalizeSlug).pipe(z.string().min(1).max(260).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/));
const fields = {
  name: z.string().trim().min(1).max(240), slug,
  description: z.string().trim().max(20000).nullable(),
  shortDescription: z.string().trim().max(500).nullable(),
  brandId: productId, categoryId: productId, status: productStatus,
  featured: z.boolean(), newArrival: z.boolean(),
};
export const createProductInput = z.strictObject({ ...fields,
  description: fields.description.optional(), shortDescription: fields.shortDescription.optional(),
  status: fields.status.default("draft"), featured: fields.featured.default(false), newArrival: fields.newArrival.default(false),
});
export const updateProductInput = z.strictObject(fields).partial().transform((value) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<z.infer<typeof createProductInput>>);
export type ProductInput = z.infer<typeof createProductInput>;
export type ProductPatch = z.infer<typeof updateProductInput>;
export const productFilters = z.strictObject({
  page: z.number().int().min(1).max(1000000).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(240).default(""),
  status: productStatus.optional(), brandId: productId.optional(), categoryId: productId.optional(),
  featured: z.boolean().optional(), newArrival: z.boolean().optional(),
  sort: z.enum(["newest", "oldest", "name_asc", "name_desc"]).default("newest"),
}).default({ page: 1, pageSize: 20, search: "", sort: "newest" });
export type ProductFilters = z.infer<typeof productFilters>;
export type Product = Omit<ProductInput, "description" | "shortDescription"> & {
  id: string; description: string | null; shortDescription: string | null; createdAt: string; updatedAt: string;
};
export type ProductDetail = Product & {
  variants: { id: string; sku: string; barcode: string | null; price: number; compareAtPrice: number | null; currency: string; status: string }[];
  images: { id: string; variantId: string | null; blobUrl: string; altText: string; isPrimary: boolean; sortOrder: number }[];
};
export type CatalogError = "VALIDATION" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "REFERENCE" | "UNAVAILABLE";
export type Failure = { ok: false; code: CatalogError; error: string };
export type MutationResult = { ok: true; productId: string; changed: boolean } | Failure;
export type ListResult = { ok: true; products: Product[]; page: number; pageSize: number; total: number; totalPages: number } | Failure;
export type DetailResult = { ok: true; product: ProductDetail } | Failure;
export const errors: Record<CatalogError, Failure> = {
  VALIDATION: { ok: false, code: "VALIDATION", error: "Check the product fields and identifier." },
  FORBIDDEN: { ok: false, code: "FORBIDDEN", error: "Access denied. Sign in with an authorized account." },
  NOT_FOUND: { ok: false, code: "NOT_FOUND", error: "Product not found." },
  CONFLICT: { ok: false, code: "CONFLICT", error: "The product slug is already in use." },
  REFERENCE: { ok: false, code: "REFERENCE", error: "Choose an existing brand and category." },
  UNAVAILABLE: { ok: false, code: "UNAVAILABLE", error: "The catalog operation could not be completed." },
};

// Preserve the existing Phase 1 form/variant contracts and public imports.
// Service inputs additionally normalize slugs and define no-op patch behavior.
export { productCreate, productUpdate, variantCreate, variantUpdate, catalogId, type ProductCreate, type VariantCreate } from "./phase1-contracts";
