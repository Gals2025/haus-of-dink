import { z } from "zod";

export const movementTypes = ["OPENING_STOCK", "PURCHASE", "SALE", "RESERVATION", "RESERVATION_RELEASE", "RETURN", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "DAMAGED", "LOST", "CANCELLED_ORDER_RESTOCK"] as const;
export const manualTypes = ["OPENING_STOCK", "PURCHASE", "RETURN", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "DAMAGED", "LOST", "CANCELLED_ORDER_RESTOCK"] as const;
export const mainLocationId = "00000000-0000-4000-8000-000000000001";
export const stockChange = z.object({
  requestId: z.uuid(),
  variantId: z.uuid(),
  locationId: z.uuid(),
  type: z.enum(movementTypes),
  quantity: z.number().int().min(1).max(1000000),
  reason: z.string().trim().min(3).max(500),
  reference: z.string().trim().max(200).default(""),
  reservationId: z.uuid().nullable().default(null),
}).strict().superRefine((value, ctx) => {
  if ((value.type === "RESERVATION_RELEASE" && !value.reservationId) ||
    (value.reservationId && !["SALE", "RESERVATION_RELEASE"].includes(value.type)) ||
    (value.type === "RESERVATION" && !value.reference)) {
    ctx.addIssue({ code: "custom", message: "Invalid reservation details." });
  }
});
export const stockFilters = z.object({
  search: z.string().trim().max(100).default(""),
  status: z.enum(["all", "low", "out"]).default("all"),
  locationId: z.uuid().default(mainLocationId),
  page: z.coerce.number().int().min(1).max(10000).default(1),
}).strict();
export type StockChange = z.infer<typeof stockChange>;
export type StockFilters = z.infer<typeof stockFilters>;
export type StockRow = { variantId: string; sku: string; name: string; onHand: number; reserved: number; available: number; reorderLevel: number };
export type MovementRow = { id: string; sku: string; location: string; type: string; quantity: number; beforeOnHand: number; afterOnHand: number; beforeReserved: number; afterReserved: number; reason: string; reference: string; actor: string; createdAt: string };
export type StockResult = { ok: true; movementId: string } | { ok: false; error: string };
export const pageSize = 25;
