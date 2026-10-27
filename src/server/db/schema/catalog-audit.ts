import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// No cascading foreign keys: history outlives a deleted account or catalog row.
export const catalogAudit = pgTable("catalog_audit", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: text("actor_id").notNull(),
  productId: uuid("product_id").notNull(),
  action: text("action").notNull(),
  changes: jsonb("changes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("catalog_audit_product_idx").on(t.productId, t.createdAt),
  check("catalog_audit_action_check", sql`${t.action} in ('create', 'update', 'archive', 'reactivate')`),
]);
