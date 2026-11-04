import { z } from "zod";
export const productImageTypes = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export const maxProductImageSize = 5 * 1024 * 1024;
export const productImageUpload = z.strictObject({
  productId: z.uuid(), variantId: z.uuid().nullable().default(null),
  contentType: z.enum(productImageTypes), size: z.number().int().positive().max(maxProductImageSize),
});
export const productImageInput = z.strictObject({
  productId: z.uuid(), variantId: z.uuid().nullable().default(null),
  imageUrl: z.url().max(2000), altText: z.string().trim().min(1).max(500),
}).refine(value => {
  const url = new URL(value.imageUrl);
  return url.protocol === "https:" && !url.port && !url.username && !url.password && !url.search && !url.hash &&
    /^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/.test(url.hostname) &&
    new RegExp(`^/product-images/${value.productId}/[0-9a-f-]{36}\\.(jpg|png|webp|avif)$`).test(url.pathname);
}, { message: "Upload a product image using the file picker.", path: ["imageUrl"] });
export type ProductImageInput = z.infer<typeof productImageInput>;
