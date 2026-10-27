import { z } from "zod";
import { normalizeSlug, type Failure } from "./contracts";

export const optionKind = z.enum(["brand", "category"]);
export type OptionKind = z.infer<typeof optionKind>;
export const createOptionInput = z.strictObject({
  name: z.string().trim().min(1).max(160),
  slug: z.string().max(720).transform(normalizeSlug).pipe(z.string().min(1).max(180).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)),
});
export type CatalogOption = { id: string; name: string; status: string };
export type OptionResult = { ok: true; option: CatalogOption } | Failure;
