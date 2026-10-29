import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { productVariants } from "./catalog";
import { inventoryLocations, inventoryReservations } from "./inventory";
import { user } from "./auth";
const dates = () => ({ createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull() });
export const customers = pgTable("customers", {
  id: uuid("id").defaultRandom().primaryKey(), name: varchar("name", { length: 160 }).notNull(),
  email: varchar("email", { length: 254 }), phone: varchar("phone", { length: 40 }).notNull(),
  address: varchar("address", { length: 1000 }).notNull(), active: boolean("active").default(true).notNull(), ...dates(),
}, (t) => [uniqueIndex("customers_email_unique").on(sql`lower(${t.email})`), check("customers_valid", sql`length(trim(${t.name})) > 0 AND (${t.email} IS NULL OR (${t.email} = lower(trim(${t.email})) AND length(${t.email}) > 3))`)]);
export const promotions = pgTable("promotions", {
  id: uuid("id").defaultRandom().primaryKey(), code: varchar("code", { length: 40 }).notNull().unique(),
  kind: text("kind").notNull(), amount: integer("amount").notNull(), minimum: integer("minimum").default(0).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(), endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  usageLimit: integer("usage_limit").notNull(), used: integer("used").default(0).notNull(), active: boolean("active").default(true).notNull(), ...dates(),
}, (t) => [check("promotions_valid", sql`${t.code} ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$' AND ${t.kind} IN ('percent','fixed') AND ${t.amount} > 0 AND (${t.kind} <> 'percent' OR ${t.amount} <= 100) AND ${t.minimum} >= 0 AND ${t.endsAt} > ${t.startsAt} AND ${t.usageLimit} > 0 AND ${t.used} >= 0 AND ${t.used} <= ${t.usageLimit}`)]);
export const storeSettings = pgTable("store_settings", {
  id: integer("id").primaryKey().default(1), name: varchar("name", { length: 160 }).notNull(),
  email: varchar("email", { length: 254 }).notNull(), phone: varchar("phone", { length: 40 }).notNull(),
  address: varchar("address", { length: 1000 }).notNull(), shippingFee: integer("shipping_fee").default(0).notNull(),
  paymentInstructions: varchar("payment_instructions", { length: 2000 }).default("").notNull(), ...dates(),
}, (t) => [check("store_settings_valid", sql`${t.id} = 1 AND length(trim(${t.name})) > 0 AND ${t.shippingFee} >= 0`)]);
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey(), customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),
  locationId: uuid("location_id").notNull().references(() => inventoryLocations.id, { onDelete: "restrict" }),
  status: text("status").default("pending").notNull(), paymentStatus: text("payment_status").default("unpaid").notNull(),
  fulfillmentMethod: text("fulfillment_method").default("delivery").notNull(), pickupPayment: text("pickup_payment"),
  paymentProofPath: varchar("payment_proof_path", { length: 500 }), holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }), rejectionReason: varchar("rejection_reason", { length: 500 }),
  paymentReference: varchar("payment_reference", { length: 200 }).default("").notNull(),
  customerSnapshot: jsonb("customer_snapshot").notNull(), subtotal: integer("subtotal").notNull(), discount: integer("discount").notNull(),
  shippingFee: integer("shipping_fee").notNull(), total: integer("total").notNull(),
  promotionId: uuid("promotion_id").references(() => promotions.id, { onDelete: "restrict" }),
  promotionCode: varchar("promotion_code", { length: 40 }), notes: varchar("notes", { length: 1000 }).notNull(),
  actorId: text("actor_id").references(() => user.id, { onDelete: "restrict" }), ...dates(),
}, (t) => [index("orders_created_idx").on(t.createdAt, t.id), index("orders_customer_idx").on(t.customerId),
  check("orders_valid", sql`${t.status} IN ('pending','awaiting_confirmation','confirmed','ready_for_pickup','out_for_delivery','fulfilled','cancelled') AND ${t.paymentStatus} IN ('unpaid','paid','refunded') AND ${t.fulfillmentMethod} IN ('delivery','pickup') AND (${t.pickupPayment} IS NULL OR ${t.pickupPayment} IN ('online','upon_pickup')) AND (${t.status} <> 'fulfilled' OR ${t.paymentStatus} = 'paid') AND (${t.status} <> 'cancelled' OR ${t.paymentStatus} <> 'paid') AND ${t.subtotal} >= 0 AND ${t.discount} >= 0 AND ${t.discount} <= ${t.subtotal} AND ${t.shippingFee} >= 0 AND ${t.total} = ${t.subtotal} - ${t.discount} + ${t.shippingFee}`)]);
export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(), orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
  variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
  reservationId: uuid("reservation_id").notNull().references(() => inventoryReservations.id, { onDelete: "restrict" }),
  sku: varchar("sku", { length: 100 }).notNull(), name: varchar("name", { length: 240 }).notNull(),
  quantity: integer("quantity").notNull(), unitPrice: integer("unit_price").notNull(), unitCost: integer("unit_cost"),
}, (t) => [index("order_items_order_idx").on(t.orderId), uniqueIndex("order_items_variant_unique").on(t.orderId, t.variantId), check("order_items_valid", sql`${t.quantity} BETWEEN 1 AND 1000000 AND ${t.unitPrice} >= 0 AND (${t.unitCost} IS NULL OR ${t.unitCost} >= 0)`)]);
export const commerceAudit = pgTable("commerce_audit", {
  id: uuid("id").defaultRandom().primaryKey(), requestId: uuid("request_id").notNull().unique(), actorId: text("actor_id"),
  entityId: uuid("entity_id").notNull(), action: text("action").notNull(), payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("commerce_audit_created_idx").on(t.createdAt)]);
