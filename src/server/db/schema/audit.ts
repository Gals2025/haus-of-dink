import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// IDs deliberately have no cascading foreign keys: history survives account deletion.
export const adminAudit = pgTable("admin_audit", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull(),
  targetId: text("target_id").notNull(),
  action: text("action").notNull(),
  beforeRole: text("before_role").notNull(),
  afterRole: text("after_role").notNull(),
  beforeActive: boolean("before_active").notNull(),
  afterActive: boolean("after_active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("admin_audit_created_idx").on(t.createdAt), index("admin_audit_target_idx").on(t.targetId)]);
