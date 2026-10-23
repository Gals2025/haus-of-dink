CREATE TYPE "public"."catalog_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "attribute_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attribute_id" uuid NOT NULL,
	"value" varchar(160) NOT NULL,
	"slug" varchar(180) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attribute_values_attribute_slug_unique" UNIQUE("attribute_id","slug"),
	CONSTRAINT "attribute_values_attribute_id_id_unique" UNIQUE("attribute_id","id"),
	CONSTRAINT "attribute_values_value_not_blank" CHECK (length(trim("attribute_values"."value")) > 0),
	CONSTRAINT "attribute_values_slug_format" CHECK ("attribute_values"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "attribute_values_order_nonnegative" CHECK ("attribute_values"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "attributes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"description" text,
	"unit" varchar(30),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attributes_slug_unique" UNIQUE("slug"),
	CONSTRAINT "attributes_name_not_blank" CHECK (length(trim("attributes"."name")) > 0),
	CONSTRAINT "attributes_slug_format" CHECK ("attributes"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(180) NOT NULL,
	"description" text,
	"website_url" text,
	"logo_url" text,
	"status" "catalog_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_slug_unique" UNIQUE("slug"),
	CONSTRAINT "brands_name_not_blank" CHECK (length(trim("brands"."name")) > 0),
	CONSTRAINT "brands_slug_format" CHECK ("brands"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(180) NOT NULL,
	"description" text,
	"parent_id" uuid,
	"status" "catalog_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "categories_not_own_parent" CHECK ("categories"."parent_id" IS NULL OR "categories"."parent_id" <> "categories"."id"),
	CONSTRAINT "categories_name_not_blank" CHECK (length(trim("categories"."name")) > 0),
	CONSTRAINT "categories_slug_format" CHECK ("categories"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "product_attribute_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"attribute_id" uuid NOT NULL,
	"attribute_value_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"blob_url" text NOT NULL,
	"alt_text" varchar(500) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_images_order_nonnegative" CHECK ("product_images"."sort_order" >= 0),
	CONSTRAINT "product_images_https_url" CHECK ("product_images"."blob_url" ~ '^https://[^/[:space:]]+/[^[:space:]]*$'),
	CONSTRAINT "product_images_alt_not_blank" CHECK (length(trim("product_images"."alt_text")) > 0)
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" varchar(100) NOT NULL,
	"barcode" varchar(100),
	"price" integer NOT NULL,
	"compare_at_price" integer,
	"cost" integer,
	"currency" varchar(3) DEFAULT 'PHP' NOT NULL,
	"status" "catalog_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_barcode_unique" UNIQUE("barcode"),
	CONSTRAINT "product_variants_product_id_id_unique" UNIQUE("product_id","id"),
	CONSTRAINT "product_variants_sku_trimmed" CHECK (length("product_variants"."sku") > 0 AND "product_variants"."sku" = trim("product_variants"."sku")),
	CONSTRAINT "product_variants_barcode_trimmed" CHECK ("product_variants"."barcode" IS NULL OR (length("product_variants"."barcode") > 0 AND "product_variants"."barcode" = trim("product_variants"."barcode"))),
	CONSTRAINT "product_variants_price_nonnegative" CHECK ("product_variants"."price" >= 0),
	CONSTRAINT "product_variants_compare_at_valid" CHECK ("product_variants"."compare_at_price" IS NULL OR "product_variants"."compare_at_price" >= "product_variants"."price"),
	CONSTRAINT "product_variants_cost_nonnegative" CHECK ("product_variants"."cost" IS NULL OR "product_variants"."cost" >= 0),
	CONSTRAINT "product_variants_currency_format" CHECK ("product_variants"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(240) NOT NULL,
	"slug" varchar(260) NOT NULL,
	"description" text,
	"short_description" varchar(500),
	"brand_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"new_arrival" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug"),
	CONSTRAINT "products_name_not_blank" CHECK (length(trim("products"."name")) > 0),
	CONSTRAINT "products_slug_format" CHECK ("products"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_attribute_id_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attributes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_variant_product_fk" FOREIGN KEY ("product_id","variant_id") REFERENCES "public"."product_variants"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_value_attribute_fk" FOREIGN KEY ("attribute_id","attribute_value_id") REFERENCES "public"."attribute_values"("attribute_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_product_fk" FOREIGN KEY ("product_id","variant_id") REFERENCES "public"."product_variants"("product_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attribute_values_value_ci_unique" ON "attribute_values" USING btree ("attribute_id",lower("value"));--> statement-breakpoint
CREATE UNIQUE INDEX "attributes_name_ci_unique" ON "attributes" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "brands_name_ci_unique" ON "brands" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "categories_parent_status_idx" ON "categories" USING btree ("parent_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "product_attribute_values_product_unique" ON "product_attribute_values" USING btree ("product_id","attribute_value_id") WHERE "product_attribute_values"."variant_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_attribute_values_variant_attribute_unique" ON "product_attribute_values" USING btree ("variant_id","attribute_id") WHERE "product_attribute_values"."variant_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "product_attribute_values_product_idx" ON "product_attribute_values" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_attribute_values_filter_idx" ON "product_attribute_values" USING btree ("attribute_id","attribute_value_id","product_id");--> statement-breakpoint
CREATE INDEX "product_images_product_order_idx" ON "product_images" USING btree ("product_id","sort_order","id");--> statement-breakpoint
CREATE INDEX "product_images_variant_order_idx" ON "product_images" USING btree ("variant_id","sort_order","id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_one_primary_product" ON "product_images" USING btree ("product_id") WHERE "product_images"."is_primary" AND "product_images"."variant_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_one_primary_variant" ON "product_images" USING btree ("variant_id") WHERE "product_images"."is_primary" AND "product_images"."variant_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_sku_ci_unique" ON "product_variants" USING btree (lower("sku"));--> statement-breakpoint
CREATE INDEX "product_variants_product_status_idx" ON "product_variants" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "products_brand_status_idx" ON "products" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "products_category_status_idx" ON "products" USING btree ("category_id","status");--> statement-breakpoint
CREATE INDEX "products_status_created_idx" ON "products" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "products_featured_idx" ON "products" USING btree ("created_at") WHERE "products"."status" = 'active' AND "products"."featured";--> statement-breakpoint
CREATE INDEX "products_new_arrival_idx" ON "products" USING btree ("created_at") WHERE "products"."status" = 'active' AND "products"."new_arrival";