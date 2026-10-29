import { z } from "zod";
const name = z.string().trim().min(1).max(160);
const contact = { name, email: z.email().trim().toLowerCase().max(254), phone: z.string().trim().max(40), address: z.string().trim().max(1000) };
const money = z.number().int().min(0).max(100000000);
const id = z.uuid();
export const commerceInput = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("customer.save"), id: id.optional(), ...contact, active: z.boolean() }),
  z.strictObject({ action: z.literal("promotion.save"), id: id.optional(), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/), kind: z.enum(["fixed", "percent"]), amount: money.positive(), minimum: money, startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }), usageLimit: z.number().int().min(1).max(1000000), active: z.boolean() })
    .refine(v => new Date(v.endsAt) > new Date(v.startsAt), "End must follow start.")
    .refine(v => v.kind !== "percent" || v.amount <= 100, "Percent must be 1–100."),
  z.strictObject({ action: z.literal("settings.save"), ...contact, shippingFee: money, paymentInstructions: z.string().trim().max(2000) }),
  z.strictObject({ action: z.literal("order.create"), customerId: id, locationId: id, promotionCode: z.string().trim().toUpperCase().max(40), notes: z.string().trim().max(1000), items: z.array(z.strictObject({ variantId: id, quantity: z.number().int().min(1).max(1000000) })).min(1).max(30) })
    .refine(v => new Set(v.items.map(i => i.variantId)).size === v.items.length, "Combine duplicate SKUs into one line."),
  z.strictObject({ action: z.literal("order.pay"), id, reference: z.string().trim().min(3).max(200) }),
  z.strictObject({ action: z.literal("order.refund"), id, reference: z.string().trim().min(3).max(200) }),
  z.strictObject({ action: z.literal("order.fulfill"), id }),
  z.strictObject({ action: z.literal("order.confirm"), id }),
  z.strictObject({ action: z.literal("order.reject"), id, reason: z.string().trim().max(500) }),
  z.strictObject({ action: z.literal("order.ready"), id }),
  z.strictObject({ action: z.literal("order.ship"), id }),
  z.strictObject({ action: z.literal("order.cancel"), id }),
]);
export type CommerceInput = z.infer<typeof commerceInput>;
export const filtersInput = z.object({ search: z.string().trim().max(160).default(""), page: z.coerce.number().int().min(1).max(100000).default(1), status: z.enum(["all","pending","awaiting_confirmation","confirmed","fulfilled","cancelled"]).default("all") });
export type Filters = z.infer<typeof filtersInput>;
export function peso(value: number) { return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value / 100); }
export function parsePesos(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) return NaN;
  const [whole, cents = ""] = text.split(".");
  return Number(whole) * 100 + Number(cents.padEnd(2,"0"));
}
export type Customer = { id: string; name: string; email: string | null; phone: string; address: string; active: boolean };
export type Promotion = { id: string; code: string; kind: "fixed" | "percent"; amount: number; minimum: number; startsAt: string; endsAt: string; usageLimit: number; used: number; active: boolean };
export type Settings = { name: string; email: string; phone: string; address: string; shippingFee: number; paymentInstructions: string };
export type Order = { id: string; customer: string; status: string; paymentStatus: string; total: number; createdAt: string };
export type OrderDetail = Order & { customerSnapshot: { name: string; email: string; phone: string; address: string }; fulfillmentMethod: "delivery"|"pickup"; pickupPayment: "online"|"upon_pickup"|null; paymentProofPath: string|null; holdExpiresAt: string|null; rejectionReason: string|null; subtotal: number; discount: number; shippingFee: number; promotionCode: string | null; paymentReference: string; notes: string; location: string; items: { sku: string; name: string; quantity: number; unitPrice: number }[]; history: { action: string; createdAt: string; actor: string }[] };
