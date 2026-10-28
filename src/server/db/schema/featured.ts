import { boolean, check, integer, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const featuredItems = pgTable("featured_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  slot: integer("slot").notNull(),
  eyebrow: varchar("eyebrow", { length: 100 }).notNull().default("FEATURED"),
  title: varchar("title", { length: 160 }).notNull(),
  description: varchar("description", { length: 500 }).notNull().default(""),
  imageUrl: text("image_url"),
  imageAlt: varchar("image_alt", { length: 240 }).notNull().default(""),
  ctaLabel: varchar("cta_label", { length: 80 }).notNull().default("Shop now"),
  href: varchar("href", { length: 500 }).notNull().default("/shop"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("featured_items_slot_unique").on(table.slot),
  check("featured_items_slot_range", sql`${table.slot} between 1 and 3`),
  check("featured_items_title_not_blank", sql`length(trim(${table.title})) > 0`),
  check("featured_items_cta_not_blank", sql`length(trim(${table.ctaLabel})) > 0`),
  check("featured_items_internal_href", sql`${table.href} like '/%' and ${table.href} not like '//%'`),
  check("featured_items_image_https", sql`${table.imageUrl} is null or ${table.imageUrl} ~ '^https://[^/[:space:]]+/[^[:space:]]*$'`),
]);
