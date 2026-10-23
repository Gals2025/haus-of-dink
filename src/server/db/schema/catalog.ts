import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn, boolean, check, foreignKey, index, integer, pgEnum,
  pgTable, text, timestamp, unique, uniqueIndex, uuid, varchar,
} from "drizzle-orm/pg-core";

export const catalogStatus = pgEnum("catalog_status", ["active", "inactive"]);
export const productStatus = pgEnum("product_status", ["draft", "active", "archived"]);
const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const brands = pgTable("brands", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  slug: varchar("slug", { length: 180 }).notNull().unique(),
  description: text("description"),
  websiteUrl: text("website_url"),
  logoUrl: text("logo_url"),
  status: catalogStatus("status").default("active").notNull(),
  ...timestamps(),
}, (t) => [
  uniqueIndex("brands_name_ci_unique").on(sql`lower(${t.name})`),
  check("brands_name_not_blank", sql`length(trim(${t.name})) > 0`),
  check("brands_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
]);

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  slug: varchar("slug", { length: 180 }).notNull().unique(),
  description: text("description"),
  parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, { onDelete: "restrict" }),
  status: catalogStatus("status").default("active").notNull(),
  ...timestamps(),
}, (t) => [
  index("categories_parent_status_idx").on(t.parentId, t.status),
  check("categories_not_own_parent", sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
  check("categories_name_not_blank", sql`length(trim(${t.name})) > 0`),
  check("categories_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
]);

export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 240 }).notNull(),
  slug: varchar("slug", { length: 260 }).notNull().unique(),
  description: text("description"),
  shortDescription: varchar("short_description", { length: 500 }),
  brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "restrict" }),
  categoryId: uuid("category_id").notNull().references(() => categories.id, { onDelete: "restrict" }),
  status: productStatus("status").default("draft").notNull(),
  featured: boolean("featured").default(false).notNull(),
  newArrival: boolean("new_arrival").default(false).notNull(),
  ...timestamps(),
}, (t) => [
  index("products_brand_status_idx").on(t.brandId, t.status),
  index("products_category_status_idx").on(t.categoryId, t.status),
  index("products_status_created_idx").on(t.status, t.createdAt),
  index("products_featured_idx").on(t.createdAt).where(sql`${t.status} = 'active' AND ${t.featured}`),
  index("products_new_arrival_idx").on(t.createdAt).where(sql`${t.status} = 'active' AND ${t.newArrival}`),
  check("products_name_not_blank", sql`length(trim(${t.name})) > 0`),
  check("products_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
]);

export const productVariants = pgTable("product_variants", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  sku: varchar("sku", { length: 100 }).notNull(),
  barcode: varchar("barcode", { length: 100 }).unique(),
  // All money is integer minor units; PHP 1,500.00 = 150000 centavos.
  price: integer("price").notNull(),
  compareAtPrice: integer("compare_at_price"),
  cost: integer("cost"),
  currency: varchar("currency", { length: 3 }).default("PHP").notNull(),
  status: catalogStatus("status").default("active").notNull(),
  ...timestamps(),
}, (t) => [
  uniqueIndex("product_variants_sku_ci_unique").on(sql`lower(${t.sku})`),
  unique("product_variants_product_id_id_unique").on(t.productId, t.id),
  index("product_variants_product_status_idx").on(t.productId, t.status),
  check("product_variants_sku_trimmed", sql`length(${t.sku}) > 0 AND ${t.sku} = trim(${t.sku})`),
  check("product_variants_barcode_trimmed", sql`${t.barcode} IS NULL OR (length(${t.barcode}) > 0 AND ${t.barcode} = trim(${t.barcode}))`),
  check("product_variants_price_nonnegative", sql`${t.price} >= 0`),
  check("product_variants_compare_at_valid", sql`${t.compareAtPrice} IS NULL OR ${t.compareAtPrice} >= ${t.price}`),
  check("product_variants_cost_nonnegative", sql`${t.cost} IS NULL OR ${t.cost} >= 0`),
  check("product_variants_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
]);

export const productImages = pgTable("product_images", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id"),
  blobUrl: text("blob_url").notNull(),
  altText: varchar("alt_text", { length: 500 }).notNull(),
  isPrimary: boolean("is_primary").default(false).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  ...timestamps(),
}, (t) => [
  foreignKey({ name: "product_images_variant_product_fk", columns: [t.productId, t.variantId], foreignColumns: [productVariants.productId, productVariants.id] }).onDelete("cascade"),
  index("product_images_product_order_idx").on(t.productId, t.sortOrder, t.id),
  index("product_images_variant_order_idx").on(t.variantId, t.sortOrder, t.id),
  uniqueIndex("product_images_one_primary_product").on(t.productId).where(sql`${t.isPrimary} AND ${t.variantId} IS NULL`),
  uniqueIndex("product_images_one_primary_variant").on(t.variantId).where(sql`${t.isPrimary} AND ${t.variantId} IS NOT NULL`),
  check("product_images_order_nonnegative", sql`${t.sortOrder} >= 0`),
  check("product_images_https_url", sql`${t.blobUrl} ~ '^https://[^/[:space:]]+/[^[:space:]]*$'`),
  check("product_images_alt_not_blank", sql`length(trim(${t.altText})) > 0`),
]);

export const attributes = pgTable("attributes", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  description: text("description"),
  unit: varchar("unit", { length: 30 }),
  ...timestamps(),
}, (t) => [
  uniqueIndex("attributes_name_ci_unique").on(sql`lower(${t.name})`),
  check("attributes_name_not_blank", sql`length(trim(${t.name})) > 0`),
  check("attributes_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
]);

export const attributeValues = pgTable("attribute_values", {
  id: uuid("id").defaultRandom().primaryKey(),
  attributeId: uuid("attribute_id").notNull().references(() => attributes.id, { onDelete: "restrict" }),
  value: varchar("value", { length: 160 }).notNull(),
  slug: varchar("slug", { length: 180 }).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  ...timestamps(),
}, (t) => [
  unique("attribute_values_attribute_slug_unique").on(t.attributeId, t.slug),
  unique("attribute_values_attribute_id_id_unique").on(t.attributeId, t.id),
  uniqueIndex("attribute_values_value_ci_unique").on(t.attributeId, sql`lower(${t.value})`),
  check("attribute_values_value_not_blank", sql`length(trim(${t.value})) > 0`),
  check("attribute_values_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  check("attribute_values_order_nonnegative", sql`${t.sortOrder} >= 0`),
]);

// NULL variantId means a product-level specification. Variant rows describe
// selectable options (e.g. Color/Size), with at most one value per attribute.
export const productAttributeValues = pgTable("product_attribute_values", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id"),
  attributeId: uuid("attribute_id").notNull(),
  attributeValueId: uuid("attribute_value_id").notNull(),
  ...timestamps(),
}, (t) => [
  foreignKey({ name: "product_attribute_values_variant_product_fk", columns: [t.productId, t.variantId], foreignColumns: [productVariants.productId, productVariants.id] }).onDelete("cascade"),
  foreignKey({ name: "product_attribute_values_value_attribute_fk", columns: [t.attributeId, t.attributeValueId], foreignColumns: [attributeValues.attributeId, attributeValues.id] }).onDelete("restrict"),
  uniqueIndex("product_attribute_values_product_unique").on(t.productId, t.attributeValueId).where(sql`${t.variantId} IS NULL`),
  uniqueIndex("product_attribute_values_variant_attribute_unique").on(t.variantId, t.attributeId).where(sql`${t.variantId} IS NOT NULL`),
  index("product_attribute_values_product_idx").on(t.productId),
  index("product_attribute_values_filter_idx").on(t.attributeId, t.attributeValueId, t.productId),
]);

export const brandsRelations = relations(brands, ({ many }) => ({ products: many(products) }));
export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, { fields: [categories.parentId], references: [categories.id], relationName: "categoryTree" }),
  children: many(categories, { relationName: "categoryTree" }), products: many(products),
}));
export const productsRelations = relations(products, ({ one, many }) => ({
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  variants: many(productVariants), images: many(productImages), attributeValues: many(productAttributeValues),
}));
export const productVariantsRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
  images: many(productImages), attributeValues: many(productAttributeValues),
}));
export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
  variant: one(productVariants, { fields: [productImages.productId, productImages.variantId], references: [productVariants.productId, productVariants.id] }),
}));
export const attributesRelations = relations(attributes, ({ many }) => ({ values: many(attributeValues) }));
export const attributeValuesRelations = relations(attributeValues, ({ one, many }) => ({
  attribute: one(attributes, { fields: [attributeValues.attributeId], references: [attributes.id] }),
  products: many(productAttributeValues),
}));
export const productAttributeValuesRelations = relations(productAttributeValues, ({ one }) => ({
  product: one(products, { fields: [productAttributeValues.productId], references: [products.id] }),
  variant: one(productVariants, { fields: [productAttributeValues.productId, productAttributeValues.variantId], references: [productVariants.productId, productVariants.id] }),
  value: one(attributeValues, { fields: [productAttributeValues.attributeId, productAttributeValues.attributeValueId], references: [attributeValues.attributeId, attributeValues.id] }),
}));
