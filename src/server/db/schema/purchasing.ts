import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, bigint, timestamp, date, primaryKey, index, uniqueIndex, check, jsonb } from "drizzle-orm/pg-core";
import { productVariants } from "./catalog";
import { inventoryLocations } from "./inventory";
import { user } from "./auth";
export const suppliers = pgTable("suppliers", {
 id: uuid("id").defaultRandom().primaryKey(), name: text("name").notNull(), contact: text("contact").default("").notNull(),
}, t=>[uniqueIndex("suppliers_name_unique").on(sql`lower(trim(${t.name}))`),check("supplier_name_valid",sql`length(trim(${t.name})) between 1 and 160 AND length(${t.contact}) <= 500`)]);
export const supplierItems = pgTable("supplier_items", {
 supplierId: uuid("supplier_id").notNull().references(()=>suppliers.id,{onDelete:"restrict"}),
 variantId: uuid("variant_id").notNull().references(()=>productVariants.id,{onDelete:"restrict"}),
 purchaseCode: text("purchase_code").default("").notNull(), defaultCost: integer("default_cost"),
},t=>[primaryKey({columns:[t.supplierId,t.variantId]}),check("supplier_item_valid",sql`length(${t.purchaseCode}) <= 100 AND (${t.defaultCost} IS NULL OR ${t.defaultCost} >= 0)`)]);
export const stockReceipts = pgTable("stock_receipts", {
 id: uuid("id").primaryKey(), supplierId: uuid("supplier_id").notNull().references(()=>suppliers.id,{onDelete:"restrict"}),
 locationId: uuid("location_id").notNull().references(()=>inventoryLocations.id,{onDelete:"restrict"}),
 deliveryDate: date("delivery_date").notNull(), reference: text("reference").notNull(),
 actorId: text("actor_id").notNull().references(()=>user.id,{onDelete:"restrict"}), payload: jsonb("payload").notNull(),
 createdAt: timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
},t=>[index("receipts_supplier_date_idx").on(t.supplierId,t.createdAt),check("receipt_reference_valid",sql`length(${t.reference}) <= 200`)]);
export const stockReceiptLines = pgTable("stock_receipt_lines", {
 id: uuid("id").defaultRandom().primaryKey(), receiptId: uuid("receipt_id").notNull().references(()=>stockReceipts.id,{onDelete:"restrict"}),
 variantId: uuid("variant_id").notNull().references(()=>productVariants.id,{onDelete:"restrict"}),
 quantity: integer("quantity").notNull(), unitCost: integer("unit_cost").notNull(), counted: integer("counted").notNull(),
 movementRequestId: uuid("movement_request_id").defaultRandom().notNull().unique(),
},t=>[uniqueIndex("receipt_variant_unique").on(t.receiptId,t.variantId),index("receipt_line_variant_idx").on(t.variantId,t.receiptId),check("receipt_line_valid",sql`${t.quantity} between 1 and 1000000 AND ${t.unitCost} >= 0 AND ${t.counted} IN (0,1)`)]);
export const stockValuations = pgTable("stock_valuations", {
 id: uuid("id").primaryKey(), variantId: uuid("variant_id").notNull().references(()=>productVariants.id,{onDelete:"restrict"}),
 locationId: uuid("location_id").notNull().references(()=>inventoryLocations.id,{onDelete:"restrict"}),
 beforeValue: bigint("before_value",{mode:"number"}), afterValue: bigint("after_value",{mode:"number"}).notNull(),
 reason: text("reason").notNull(), actorId:text("actor_id").notNull().references(()=>user.id,{onDelete:"restrict"}),
 createdAt:timestamp("created_at",{withTimezone:true}).defaultNow().notNull(),
},t=>[check("valuation_valid",sql`${t.afterValue} >= 0 AND length(trim(${t.reason})) between 3 and 500`)]);
