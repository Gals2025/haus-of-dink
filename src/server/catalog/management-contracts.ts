import { z } from "zod";
import { normalizeSlug } from "./contracts";

export const entityKind = z.enum(["brand", "category", "attribute", "value"]);
export type EntityKind = z.infer<typeof entityKind>;
const text = (max: number) => z.string().trim().max(max).nullable();
const url = z.url().max(2000).refine((s) => new URL(s).protocol === "https:", "Use an HTTPS URL.").nullable();
const slug = (max: number) => z.string().max(1040).transform(normalizeSlug).pipe(z.string().min(1).max(max).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/));
const common = { name: z.string().trim().min(1).max(160), slug: slug(180), description: text(20000).default(null), status: z.enum(["active", "inactive"]).default("active") };
export const entityInputs = {
  brand: z.strictObject({ ...common, websiteUrl: url.default(null), logoUrl: url.default(null) }),
  category: z.strictObject({ ...common, parentId: z.uuid().nullable().default(null) }),
  attribute: z.strictObject({ name: z.string().trim().min(1).max(100), slug: slug(120), description: text(20000).default(null), unit: text(30).default(null) }),
  value: z.strictObject({ attributeId: z.uuid(), value: z.string().trim().min(1).max(160), slug: slug(180), sortOrder: z.number().int().min(0).max(2147483647).default(0) }),
};
export type ManagedEntity = {
  id: string; name: string; slug: string; description: string | null; status?: "active" | "inactive";
  websiteUrl?: string | null; logoUrl?: string | null; parentId?: string | null; unit?: string | null;
  attributeId?: string; value?: string; sortOrder?: number; usage: number;
};
export type AttributeOption = { id: string; name: string; values: { id: string; value: string }[] };
export type ManagementData = { brands: ManagedEntity[]; categories: ManagedEntity[]; attributes: ManagedEntity[]; values: ManagedEntity[] };
