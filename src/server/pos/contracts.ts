import { z } from "zod";

export const posSaleInput = z.strictObject({
  requestId: z.uuid(),
  locationId: z.uuid(),
  customerName: z.string().trim().max(160).default(""),
  paymentMethod: z.enum(["cash", "gcash", "card", "bank_transfer"]),
  amountTendered: z.number().int().min(0).max(2_147_483_647),
  items: z.array(z.strictObject({ variantId: z.uuid(), quantity: z.number().int().min(1).max(10000) })).min(1).max(50),
}).refine(v => new Set(v.items.map(i => i.variantId)).size === v.items.length, "Combine the same SKU into one cart line.");

export type PosSaleInput = z.infer<typeof posSaleInput>;
export type PosLocation = { id: string; name: string };
export type PosProduct = { id: string; name: string; sku: string; barcode: string | null; price: number; stock: Record<string, number> };
