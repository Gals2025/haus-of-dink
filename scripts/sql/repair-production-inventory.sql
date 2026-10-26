-- Haus of Dink: recovery for the production baseline inspected on 2026-10-26.
-- Required: catalog absent; inventory_movement_type and inventory_locations exist;
-- inventory_balances, inventory_reservations and inventory_movements absent.
-- Run the COMPLETE script once, in the production Neon SQL Editor.
-- This does not change auth accounts, passwords, sessions or migration history.
-- Do not run old migrations 0000/0001/0005 separately after this repair.
BEGIN;
SET LOCAL search_path TO public, pg_catalog;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(1948401, 5);
DO $preflight$
DECLARE item text; labels text[];
BEGIN
  FOREACH item IN ARRAY ARRAY['brands', 'categories', 'products', 'product_variants',
    'attributes', 'attribute_values', 'product_images', 'product_attribute_values',
    'inventory_balances', 'inventory_reservations', 'inventory_movements']
  LOOP
    IF to_regclass('public.' || item) IS NOT NULL THEN
      RAISE EXCEPTION 'Recovery stopped: table % already exists. Inspect the current baseline before proceeding.', item;
    END IF;
  END LOOP;
  IF to_regtype('public.catalog_status') IS NOT NULL OR to_regtype('public.product_status') IS NOT NULL THEN
    RAISE EXCEPTION 'Recovery stopped: catalog types already exist.';
  END IF;
  IF to_regclass('public.inventory_locations') IS NULL OR to_regtype('public.inventory_movement_type') IS NULL THEN
    RAISE EXCEPTION 'Recovery stopped: the expected partial inventory objects are missing.';
  END IF;
  IF to_regclass('public."user"') IS NULL THEN
    RAISE EXCEPTION 'Recovery stopped: the existing authentication user table is missing.';
  END IF;
  SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) INTO labels
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'inventory_movement_type';
  IF labels IS DISTINCT FROM ARRAY['OPENING_STOCK', 'PURCHASE', 'SALE', 'RESERVATION',
    'RESERVATION_RELEASE', 'RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGED', 'LOST',
    'CANCELLED_ORDER_RESTOCK']::text[] THEN
    RAISE EXCEPTION 'Recovery stopped: inventory movement types differ from the expected schema.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_locations
    WHERE id = '00000000-0000-4000-8000-000000000001'::uuid AND name <> 'Main stockroom') THEN
    RAISE EXCEPTION 'Recovery stopped: default location ID has another name.';
  END IF;
END;
$preflight$;
-- Preserve every existing location. Restore the default only if it is absent.
INSERT INTO public.inventory_locations(id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Main stockroom')
ON CONFLICT (id) DO NOTHING;

-- Original migration 0000: catalog foundation.
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

-- Original migration 0001: catalog integrity.
-- Database-managed timestamps also cover writes made outside Drizzle.
CREATE FUNCTION public.catalog_set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER brands_updated_at BEFORE UPDATE ON public.brands
FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER categories_updated_at BEFORE UPDATE ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER product_variants_updated_at BEFORE UPDATE ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER product_images_updated_at BEFORE UPDATE ON public.product_images
FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER attributes_updated_at BEFORE UPDATE ON public.attributes
FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER attribute_values_updated_at BEFORE UPDATE ON public.attribute_values
FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER product_attribute_values_updated_at BEFORE UPDATE ON public.product_attribute_values
FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
--> statement-breakpoint
-- Serialize hierarchy writes, then reject indirect cycles as well as self-parenting.
-- Application hierarchy writes should use READ COMMITTED (PostgreSQL default).
CREATE FUNCTION public.catalog_check_category_cycle() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(729142001);
  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM public.categories WHERE id = NEW.parent_id
      UNION
      SELECT c.id, c.parent_id FROM public.categories c
      JOIN ancestors a ON c.id = a.parent_id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Category hierarchy cannot contain a cycle'
      USING ERRCODE = '23514', CONSTRAINT = 'categories_no_cycles';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER categories_no_cycles
AFTER INSERT OR UPDATE ON public.categories
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION public.catalog_check_category_cycle();


-- Remaining migration 0005: retain the existing enum and locations.
CREATE TABLE inventory_balances (
 variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
 location_id uuid NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
 on_hand integer NOT NULL DEFAULT 0, reserved integer NOT NULL DEFAULT 0,
 reorder_level integer NOT NULL DEFAULT 5, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(variant_id, location_id),
 CONSTRAINT inventory_balance_valid CHECK (on_hand >= 0 AND reserved >= 0 AND reserved <= on_hand AND reorder_level >= 0)
);
--> statement-breakpoint
CREATE TABLE inventory_reservations (
 id uuid PRIMARY KEY, variant_id uuid NOT NULL, location_id uuid NOT NULL,
 quantity integer NOT NULL, remaining integer NOT NULL, reference varchar(200) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(variant_id, location_id) REFERENCES inventory_balances(variant_id, location_id) ON DELETE RESTRICT,
 CONSTRAINT inventory_reservation_valid CHECK (quantity > 0 AND remaining >= 0 AND remaining <= quantity)
);
--> statement-breakpoint
CREATE INDEX inventory_reservation_balance_idx ON inventory_reservations(variant_id, location_id);
--> statement-breakpoint
CREATE TABLE inventory_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL UNIQUE,
 variant_id uuid NOT NULL, location_id uuid NOT NULL, type inventory_movement_type NOT NULL,
 quantity integer NOT NULL, before_on_hand integer NOT NULL, after_on_hand integer NOT NULL,
 before_reserved integer NOT NULL, after_reserved integer NOT NULL,
 reservation_id uuid REFERENCES inventory_reservations(id) ON DELETE RESTRICT,
 reason varchar(500) NOT NULL, reference varchar(200) NOT NULL DEFAULT '',
 actor_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(variant_id, location_id) REFERENCES inventory_balances(variant_id, location_id) ON DELETE RESTRICT,
 CONSTRAINT inventory_movement_quantity CHECK (quantity > 0),
 CONSTRAINT inventory_movement_reason CHECK (length(trim(reason)) >= 3),
 CONSTRAINT inventory_movement_balances CHECK (before_on_hand >= before_reserved AND before_reserved >= 0 AND after_on_hand >= after_reserved AND after_reserved >= 0)
);
--> statement-breakpoint
CREATE INDEX inventory_movements_history_idx ON inventory_movements(created_at, id);
--> statement-breakpoint
CREATE INDEX inventory_movements_balance_idx ON inventory_movements(variant_id, location_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX inventory_one_opening ON inventory_movements(variant_id, location_id) WHERE type = 'OPENING_STOCK';
--> statement-breakpoint
CREATE FUNCTION inventory_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Inventory history is append-only'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER inventory_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON inventory_movements FOR EACH STATEMENT EXECUTE FUNCTION inventory_immutable();
--> statement-breakpoint
-- VOLATILE PL/pgSQL obtains fresh snapshots for each statement after waiting on
-- a lock. All stock changes and their audit entry succeed or roll back together.
-- Invoker rights only. No elevated database privilege is granted.
CREATE FUNCTION inventory_apply(
 p_request uuid, p_variant uuid, p_location uuid, p_type inventory_movement_type,
 p_quantity integer, p_reason text, p_reference text, p_reservation uuid, p_actor text
) RETURNS uuid LANGUAGE plpgsql VOLATILE AS $$
DECLARE
 b inventory_balances%ROWTYPE;
 prior inventory_movements%ROWTYPE;
 r inventory_reservations%ROWTYPE;
 new_hand integer; new_reserved integer; movement_id uuid;
 reservation_id uuid;
BEGIN
 IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 1000000 OR p_type IS NULL OR
    p_reason IS NULL OR length(trim(p_reason)) < 3 OR length(p_reason) > 500 OR
    p_reference IS NULL OR length(p_reference) > 200 THEN RAISE EXCEPTION 'Invalid inventory input'; END IF;
 -- Same request serializes even if a malicious retry changes its SKU/location.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text, 1948402));
 SELECT * INTO prior FROM inventory_movements WHERE request_id = p_request;
 IF FOUND THEN
   IF prior.variant_id <> p_variant OR prior.location_id <> p_location OR prior.type <> p_type OR
      prior.quantity <> p_quantity OR prior.reason <> p_reason OR prior.reference <> p_reference OR
      prior.actor_id <> p_actor OR
      prior.reservation_id IS DISTINCT FROM (CASE WHEN p_type = 'RESERVATION' THEN p_request ELSE p_reservation END)
   THEN RAISE EXCEPTION 'Request ID already used for a different movement'; END IF;
   RETURN prior.id;
 END IF;
 IF p_reservation IS NOT NULL AND p_type NOT IN ('SALE', 'RESERVATION_RELEASE') THEN
   RAISE EXCEPTION 'Unexpected reservation';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_variant::text || '/' || p_location::text, 1948403));
 -- Fail before balance creation for missing/archived SKUs or missing locations.
 IF NOT EXISTS (SELECT 1 FROM product_variants v JOIN products p ON p.id = v.product_id
                WHERE v.id = p_variant AND v.status = 'active' AND p.status <> 'archived') THEN
   RAISE EXCEPTION 'Variant unavailable';
 END IF;
 INSERT INTO inventory_balances(variant_id, location_id) VALUES(p_variant, p_location) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT b FROM inventory_balances WHERE variant_id = p_variant AND location_id = p_location FOR UPDATE;
 new_hand := b.on_hand; new_reserved := b.reserved;
 reservation_id := p_reservation;
 IF p_type = 'OPENING_STOCK' THEN
   IF EXISTS (SELECT 1 FROM inventory_movements WHERE variant_id = p_variant AND location_id = p_location) THEN
     RAISE EXCEPTION 'Opening stock must be the first movement';
   END IF;
   new_hand := new_hand + p_quantity;
 ELSIF p_type IN ('PURCHASE', 'RETURN', 'ADJUSTMENT_IN', 'CANCELLED_ORDER_RESTOCK') THEN
   new_hand := new_hand + p_quantity;
 ELSIF p_type = 'RESERVATION' THEN
   IF length(trim(p_reference)) = 0 THEN RAISE EXCEPTION 'Reservation reference required'; END IF;
   reservation_id := p_request;
   new_reserved := new_reserved + p_quantity;
   INSERT INTO inventory_reservations(id, variant_id, location_id, quantity, remaining, reference)
     VALUES(reservation_id, p_variant, p_location, p_quantity, p_quantity, p_reference);
 ELSIF p_type IN ('SALE', 'RESERVATION_RELEASE') AND p_reservation IS NOT NULL THEN
   SELECT * INTO r FROM inventory_reservations WHERE id = p_reservation
     AND variant_id = p_variant AND location_id = p_location FOR UPDATE;
   IF NOT FOUND OR r.remaining < p_quantity THEN RAISE EXCEPTION 'Reservation unavailable or quantity exceeded'; END IF;
   UPDATE inventory_reservations SET remaining = remaining - p_quantity WHERE id = p_reservation;
   new_reserved := new_reserved - p_quantity;
   IF p_type = 'SALE' THEN new_hand := new_hand - p_quantity; END IF;
 ELSIF p_type = 'RESERVATION_RELEASE' THEN
   RAISE EXCEPTION 'Reservation ID required';
 ELSE
   new_hand := new_hand - p_quantity;
 END IF;
 IF new_hand < 0 OR new_reserved < 0 OR new_reserved > new_hand THEN
   RAISE EXCEPTION 'Insufficient available stock';
 END IF;
 UPDATE inventory_balances SET on_hand = new_hand, reserved = new_reserved, updated_at = clock_timestamp()
   WHERE variant_id = p_variant AND location_id = p_location;
 INSERT INTO inventory_movements(request_id, variant_id, location_id, type, quantity,
   before_on_hand, after_on_hand, before_reserved, after_reserved, reservation_id, reason, reference, actor_id)
 VALUES(p_request, p_variant, p_location, p_type, p_quantity, b.on_hand, new_hand, b.reserved,
   new_reserved, reservation_id, p_reason, p_reference, p_actor) RETURNING id INTO movement_id;
 RETURN movement_id;
END;
$$;

COMMIT;

-- Verification: both counts must match; all four inventory tables must exist.
SELECT 'Catalog tables' AS check_name, count(*)::int AS actual, 8 AS expected
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('brands', 'categories', 'products',
  'product_variants', 'attributes', 'attribute_values', 'product_images', 'product_attribute_values')
UNION ALL
SELECT 'Inventory tables', count(*)::int, 4
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('inventory_locations', 'inventory_balances',
  'inventory_reservations', 'inventory_movements');
