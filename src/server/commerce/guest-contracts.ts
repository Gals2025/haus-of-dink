import { z } from "zod";
export const guestInput = z.strictObject({
  action: z.literal("order.guest"),
  contact: z.strictObject({
    name: z.string().trim().min(1).max(160),
    email: z.preprocess(v => typeof v === "string" ? v.trim().toLowerCase() : v, z.union([z.literal(""), z.email().max(254)])),
    phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,40}$/, "Enter a valid contact number."),
    address: z.string().trim().max(1000),
  }),
  fulfillment: z.enum(["delivery", "pickup"]),
  pickupPayment: z.enum(["online", "upon_pickup"]).optional(),
  proofPath: z.string().regex(/^payment-proofs\/[0-9a-f-]{36}$/).optional(),
  items: z.array(z.strictObject({ variantId: z.uuid(), quantity: z.number().int().min(1).max(10) })).min(1).max(30),
  promotionCode: z.string().trim().toUpperCase().max(40),
  notes: z.string().trim().max(1000),
}).refine(v => new Set(v.items.map(i => i.variantId)).size === v.items.length, "Combine duplicate items.")
  .refine(v => v.fulfillment !== "delivery" || v.contact.address.length >= 5, "Enter a delivery address.")
  .refine(v => v.fulfillment !== "pickup" || v.contact.address === "", "Pickup orders must not include a delivery address.")
  .refine(v => v.fulfillment !== "delivery" || v.pickupPayment === undefined, "Pickup payment applies only to pickup orders.")
  .refine(v => v.fulfillment !== "pickup" || !!v.pickupPayment, "Choose a pickup payment method.")
  .refine(v => (v.fulfillment !== "delivery" && v.pickupPayment !== "online") || !!v.proofPath, "Upload proof of payment.")
  .refine(v => !(v.fulfillment === "pickup" && v.pickupPayment === "upon_pickup") || v.proofPath === undefined, "Pay-on-pickup orders must not include online payment proof.");
export type GuestInput = z.infer<typeof guestInput>;
export type ShopItem = { id: string; name: string; sku: string; price: number; available: number };
export type ShopCatalogItem = ShopItem & {
  brand: string; category: string; description: string | null;
  compareAtPrice: number | null; featured: boolean; newArrival: boolean;
  imageUrl: string | null; imageAlt: string | null;
};
export type CheckoutResult = { ok: true; id: string; total: number } | { ok: false; error: string };
