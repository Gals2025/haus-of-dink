import { z } from "zod";

// All prices are integer minor units (centavos for PHP).
const money = z.number().int().min(0).max(2_147_483_647);
const slug = z.string().trim().min(1).max(260).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const uuid = z.uuid();
const optionalText = (max: number) => z.string().trim().max(max).nullable();

export const productCreate = z.object({
  name: z.string().trim().min(1).max(240),
  slug,
  description: optionalText(20_000).default(null),
  shortDescription: optionalText(500).default(null),
  brandId: uuid,
  categoryId: uuid,
  status: z.enum(["draft", "active", "archived"]).default("draft"),
  featured: z.boolean().default(false),
  newArrival: z.boolean().default(false),
}).strict();

// Zod 4 partial() can preserve defaults: use default-free update fields.
export const productUpdate = z.object({
  name: z.string().trim().min(1).max(240).optional(),
  slug: slug.optional(),
  description: optionalText(20_000).optional(),
  shortDescription: optionalText(500).optional(),
  brandId: uuid.optional(),
  categoryId: uuid.optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  featured: z.boolean().optional(),
  newArrival: z.boolean().optional(),
}).strict().refine(
  value => Object.keys(value).length > 0, "Provide at least one field."
);

const variantFields = z.object({
  sku: z.string().trim().min(1).max(100),
  barcode: z.string().min(1).max(100).refine(value => value.trim() === value && value.length > 0, "Barcode must be nonblank and trimmed.").nullable().default(null),
  price: money,
  compareAtPrice: money.nullable().default(null),
  cost: money.nullable().default(null),
  currency: z.string().regex(/^[A-Z]{3}$/).default("PHP"),
  status: z.enum(["active", "inactive"]).default("active"),
}).strict();

const validPrices = (v: { price: number; compareAtPrice?: number | null }) =>
  v.compareAtPrice == null || v.compareAtPrice >= v.price;

export const variantCreate = variantFields.extend({
  productId: uuid,
  attributeValueIds: z.array(uuid).max(30).refine(
    values => new Set(values).size === values.length,
    "Duplicate attribute values are not allowed."
  ).default([]),
}).refine(validPrices, { path: ["compareAtPrice"], message: "Compare-at price cannot be below price." });

export const variantUpdate = z.object({
  sku: z.string().trim().min(1).max(100).optional(),
  barcode: z.string().min(1).max(100).refine(value => value.trim() === value && value.length > 0, "Barcode must be nonblank and trimmed.").nullable().optional(),
  price: money.optional(),
  compareAtPrice: money.nullable().optional(),
  cost: money.nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  attributeValueIds: z.array(uuid).max(30).refine(
    values => new Set(values).size === values.length,
    "Duplicate attribute values are not allowed."
  ).optional(),
}).strict().refine(value => Object.keys(value).length > 0, "Provide at least one field.");

export const catalogId = uuid;
export type ProductCreate = z.infer<typeof productCreate>;
export type VariantCreate = z.infer<typeof variantCreate>;
