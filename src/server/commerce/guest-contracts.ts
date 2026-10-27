import { z } from "zod";
export const guestInput = z.strictObject({
  action: z.literal("order.guest"),
  contact: z.strictObject({
    name: z.string().trim().min(1).max(160),
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,40}$/, "Enter a valid contact number."),
    address: z.string().trim().min(5).max(1000),
  }),
  items: z.array(z.strictObject({ variantId: z.uuid(), quantity: z.number().int().min(1).max(10) })).min(1).max(30),
  promotionCode: z.string().trim().toUpperCase().max(40),
  notes: z.string().trim().max(1000),
}).refine(v => new Set(v.items.map(i => i.variantId)).size === v.items.length, "Combine duplicate items.");
export type GuestInput = z.infer<typeof guestInput>;
export type ShopItem = { id: string; name: string; sku: string; price: number; available: number };
export type ShopCatalogItem = ShopItem & {
  brand: string; category: string; description: string | null;
  compareAtPrice: number | null; featured: boolean; newArrival: boolean;
  imageUrl: string | null; imageAlt: string | null;
};
export type CheckoutResult = { ok: true; id: string; total: number } | { ok: false; error: string };
