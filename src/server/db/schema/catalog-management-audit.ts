import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Independent identifiers preserve history when an unused entity is removed.
export const catalogManagementAudit = pgTable("catalog_management_audit", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: text("actor_id").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  changes: jsonb("changes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("catalog_management_audit_entity_idx").on(t.entityType, t.entityId, t.createdAt),
  check("catalog_management_audit_type_check", sql`${t.entityType} in ('brand', 'category', 'attribute', 'value')`),
  check("catalog_management_audit_action_check", sql`${t.action} in ('create', 'update', 'delete')`),
]);
