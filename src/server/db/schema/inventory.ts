import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { productVariants } from "./catalog";
import { user } from "./auth";
import { movementTypes } from "../../inventory/contracts";

export const inventoryMovementType = pgEnum("inventory_movement_type", movementTypes);
export const inventoryLocations = pgTable("inventory_locations", {
  id: uuid("id").defaultRandom().primaryKey(), name: varchar("name", { length: 160 }).notNull().unique(),
}, (t) => [check("inventory_location_name", sql`length(trim(${t.name})) > 0`)]);
export const inventoryBalances = pgTable("inventory_balances", {
  variantId: uuid("variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
  locationId: uuid("location_id").notNull().references(() => inventoryLocations.id, { onDelete: "restrict" }),
  onHand: integer("on_hand").default(0).notNull(), reserved: integer("reserved").default(0).notNull(),
  reorderLevel: integer("reorder_level").default(5).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.variantId, t.locationId] }),
  check("inventory_balance_valid", sql`${t.onHand} >= 0 AND ${t.reserved} >= 0 AND ${t.reserved} <= ${t.onHand} AND ${t.reorderLevel} >= 0`),
  index("inventory_balances_location_idx").on(t.locationId, t.variantId)]);
export const inventoryReservations = pgTable("inventory_reservations", {
  id: uuid("id").primaryKey(), variantId: uuid("variant_id").notNull(), locationId: uuid("location_id").notNull(),
  quantity: integer("quantity").notNull(), remaining: integer("remaining").notNull(),
  reference: varchar("reference", { length: 200 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [foreignKey({ columns: [t.variantId, t.locationId], foreignColumns: [inventoryBalances.variantId, inventoryBalances.locationId] }).onDelete("restrict"),
  check("inventory_reservation_valid", sql`${t.quantity} > 0 AND ${t.remaining} >= 0 AND ${t.remaining} <= ${t.quantity}`),
  check("inventory_reservation_reference", sql`length(trim(${t.reference})) > 0`),
  unique("inventory_reservations_id_balance_unique").on(t.id, t.variantId, t.locationId),
  index("inventory_reservation_balance_idx").on(t.variantId, t.locationId)]);
export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid("id").defaultRandom().primaryKey(), requestId: uuid("request_id").notNull().unique(),
  variantId: uuid("variant_id").notNull(), locationId: uuid("location_id").notNull(),
  type: inventoryMovementType("type").notNull(), quantity: integer("quantity").notNull(),
  beforeOnHand: integer("before_on_hand").notNull(), afterOnHand: integer("after_on_hand").notNull(),
  beforeReserved: integer("before_reserved").notNull(), afterReserved: integer("after_reserved").notNull(),
  // Each movement is one location's ledger entry. Reservation-only movements
  // have no physical endpoint. A future transfer must record both legs atomically.
  sourceLocationId: uuid("source_location_id").generatedAlwaysAs(sql`CASE WHEN after_on_hand < before_on_hand THEN location_id END`).references(() => inventoryLocations.id, { onDelete: "restrict" }),
  destinationLocationId: uuid("destination_location_id").generatedAlwaysAs(sql`CASE WHEN after_on_hand > before_on_hand THEN location_id END`).references(() => inventoryLocations.id, { onDelete: "restrict" }),
  reversalOfId: uuid("reversal_of_id"),
  reservationId: uuid("reservation_id").references(() => inventoryReservations.id, { onDelete: "restrict" }),
  reason: varchar("reason", { length: 500 }).notNull(), reference: varchar("reference", { length: 200 }).default("").notNull(),
  actorId: text("actor_id").references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [foreignKey({ columns: [t.variantId, t.locationId], foreignColumns: [inventoryBalances.variantId, inventoryBalances.locationId] }).onDelete("restrict"),
  foreignKey({ name: "inventory_movement_reservation_balance_fk", columns: [t.reservationId, t.variantId, t.locationId], foreignColumns: [inventoryReservations.id, inventoryReservations.variantId, inventoryReservations.locationId] }).onDelete("restrict"),
  foreignKey({ name: "inventory_movement_reversal_balance_fk", columns: [t.reversalOfId, t.variantId, t.locationId], foreignColumns: [t.id, t.variantId, t.locationId] }).onDelete("restrict"),
  unique("inventory_movements_id_balance_unique").on(t.id, t.variantId, t.locationId),
  uniqueIndex("inventory_movements_one_reversal").on(t.reversalOfId).where(sql`${t.reversalOfId} IS NOT NULL`),
  check("inventory_movement_not_self_reversal", sql`${t.reversalOfId} IS NULL OR ${t.reversalOfId} <> ${t.id}`),
  check("inventory_movement_reservation_type", sql`(${t.type} = 'RESERVATION' AND ${t.reservationId} IS NOT NULL) OR (${t.type} = 'RESERVATION_RELEASE' AND ${t.reservationId} IS NOT NULL) OR ${t.type} = 'SALE' OR (${t.type} NOT IN ('RESERVATION', 'RESERVATION_RELEASE', 'SALE') AND ${t.reservationId} IS NULL)`),
  check("inventory_movement_delta", sql`CASE
    WHEN ${t.type} IN ('OPENING_STOCK', 'PURCHASE', 'RETURN', 'ADJUSTMENT_IN', 'CANCELLED_ORDER_RESTOCK') THEN ${t.afterOnHand} - ${t.beforeOnHand} = ${t.quantity} AND ${t.afterReserved} = ${t.beforeReserved}
    WHEN ${t.type} = 'RESERVATION' THEN ${t.afterOnHand} = ${t.beforeOnHand} AND ${t.afterReserved} - ${t.beforeReserved} = ${t.quantity}
    WHEN ${t.type} = 'RESERVATION_RELEASE' THEN ${t.afterOnHand} = ${t.beforeOnHand} AND ${t.beforeReserved} - ${t.afterReserved} = ${t.quantity}
    WHEN ${t.type} = 'SALE' AND ${t.reservationId} IS NOT NULL THEN ${t.beforeOnHand} - ${t.afterOnHand} = ${t.quantity} AND ${t.beforeReserved} - ${t.afterReserved} = ${t.quantity}
    ELSE ${t.beforeOnHand} - ${t.afterOnHand} = ${t.quantity} AND ${t.afterReserved} = ${t.beforeReserved} END`),
  check("inventory_movement_quantity", sql`${t.quantity} > 0`),
  check("inventory_movement_reason", sql`length(trim(${t.reason})) >= 3`),
  check("inventory_movement_balances", sql`${t.beforeOnHand} >= ${t.beforeReserved} AND ${t.beforeReserved} >= 0 AND ${t.afterOnHand} >= ${t.afterReserved} AND ${t.afterReserved} >= 0`),
  index("inventory_movements_history_idx").on(t.createdAt, t.id),
  index("inventory_movements_balance_idx").on(t.variantId, t.locationId, t.createdAt),
  index("inventory_movements_actor_idx").on(t.actorId),
  index("inventory_movements_reservation_idx").on(t.reservationId),
  index("inventory_movements_source_idx").on(t.sourceLocationId),
  index("inventory_movements_destination_idx").on(t.destinationLocationId),
  uniqueIndex("inventory_one_opening").on(t.variantId, t.locationId).where(sql`${t.type} = 'OPENING_STOCK'`)]);
