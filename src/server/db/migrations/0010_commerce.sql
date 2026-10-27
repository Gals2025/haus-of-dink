CREATE TABLE "commerce_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_audit_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"email" varchar(254) NOT NULL,
	"phone" varchar(40) NOT NULL,
	"address" varchar(1000) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_valid" CHECK (length(trim("customers"."name")) > 0 AND "customers"."email" = lower(trim("customers"."email")) AND length("customers"."email") > 3)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"sku" varchar(100) NOT NULL,
	"name" varchar(240) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer NOT NULL,
	"unit_cost" integer,
	CONSTRAINT "order_items_valid" CHECK ("order_items"."quantity" BETWEEN 1 AND 1000000 AND "order_items"."unit_price" >= 0 AND ("order_items"."unit_cost" IS NULL OR "order_items"."unit_cost" >= 0))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"payment_reference" varchar(200) DEFAULT '' NOT NULL,
	"customer_snapshot" jsonb NOT NULL,
	"subtotal" integer NOT NULL,
	"discount" integer NOT NULL,
	"shipping_fee" integer NOT NULL,
	"total" integer NOT NULL,
	"promotion_id" uuid,
	"promotion_code" varchar(40),
	"notes" varchar(1000) NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_valid" CHECK ("orders"."status" IN ('pending','fulfilled','cancelled') AND "orders"."payment_status" IN ('unpaid','paid','refunded') AND ("orders"."status" <> 'fulfilled' OR "orders"."payment_status" = 'paid') AND ("orders"."status" <> 'cancelled' OR "orders"."payment_status" <> 'paid') AND "orders"."subtotal" >= 0 AND "orders"."discount" >= 0 AND "orders"."discount" <= "orders"."subtotal" AND "orders"."shipping_fee" >= 0 AND "orders"."total" = "orders"."subtotal" - "orders"."discount" + "orders"."shipping_fee")
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40) NOT NULL,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"minimum" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"usage_limit" integer NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_code_unique" UNIQUE("code"),
	CONSTRAINT "promotions_valid" CHECK ("promotions"."code" ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$' AND "promotions"."kind" IN ('percent','fixed') AND "promotions"."amount" > 0 AND ("promotions"."kind" <> 'percent' OR "promotions"."amount" <= 100) AND "promotions"."minimum" >= 0 AND "promotions"."ends_at" > "promotions"."starts_at" AND "promotions"."usage_limit" > 0 AND "promotions"."used" >= 0 AND "promotions"."used" <= "promotions"."usage_limit")
);
--> statement-breakpoint
CREATE TABLE "store_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" varchar(160) NOT NULL,
	"email" varchar(254) NOT NULL,
	"phone" varchar(40) NOT NULL,
	"address" varchar(1000) NOT NULL,
	"shipping_fee" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_settings_valid" CHECK ("store_settings"."id" = 1 AND length(trim("store_settings"."name")) > 0 AND "store_settings"."shipping_fee" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_reservation_id_inventory_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."inventory_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commerce_audit_created_idx" ON "commerce_audit" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_email_unique" ON "customers" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_variant_unique" ON "order_items" USING btree ("order_id","variant_id");--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE TRIGGER commerce_audit_immutable BEFORE UPDATE OR DELETE ON commerce_audit FOR EACH ROW EXECUTE FUNCTION reject_catalog_audit_change();
--> statement-breakpoint
CREATE TRIGGER commerce_audit_no_truncate BEFORE TRUNCATE ON commerce_audit FOR EACH STATEMENT EXECUTE FUNCTION reject_catalog_audit_change();
--> statement-breakpoint
-- Called only through an authenticated statement under the existing management lock.
-- Inventory reservations, payment transitions, promotion counters and audit commit together.
CREATE FUNCTION commerce_execute(p_actor text, p_request uuid, p_input jsonb) RETURNS uuid LANGUAGE plpgsql VOLATILE AS $$
DECLARE
 action text := p_input->>'action'; target uuid; prior commerce_audit%ROWTYPE;
 customer customers%ROWTYPE; promo promotions%ROWTYPE; ord orders%ROWTYPE;
 item jsonb; variant record; line record; reservation uuid;
 subtotal bigint := 0; discount bigint := 0; shipping integer := 0; quantity integer;
BEGIN
 SELECT * INTO prior FROM commerce_audit WHERE request_id = p_request;
 IF FOUND THEN
   IF prior.actor_id <> p_actor OR prior.payload <> p_input THEN RAISE EXCEPTION 'Request already used'; END IF;
   RETURN prior.entity_id;
 END IF;
 target := coalesce((p_input->>'id')::uuid, gen_random_uuid());
 IF action = 'customer.save' THEN
   IF p_input ? 'id' THEN
     UPDATE customers SET name=p_input->>'name', email=p_input->>'email', phone=p_input->>'phone', address=p_input->>'address', active=(p_input->>'active')::boolean, updated_at=clock_timestamp() WHERE id=target;
     IF NOT FOUND THEN RAISE EXCEPTION 'Customer unavailable'; END IF;
   ELSE
     INSERT INTO customers(id,name,email,phone,address,active) VALUES(target,p_input->>'name',p_input->>'email',p_input->>'phone',p_input->>'address',(p_input->>'active')::boolean);
   END IF;
 ELSIF action = 'promotion.save' THEN
   IF p_input ? 'id' THEN
     UPDATE promotions SET code=p_input->>'code', kind=p_input->>'kind', amount=(p_input->>'amount')::integer, minimum=(p_input->>'minimum')::integer,
       starts_at=(p_input->>'startsAt')::timestamptz, ends_at=(p_input->>'endsAt')::timestamptz, usage_limit=(p_input->>'usageLimit')::integer,
       active=(p_input->>'active')::boolean, updated_at=clock_timestamp() WHERE id=target;
     IF NOT FOUND THEN RAISE EXCEPTION 'Promotion unavailable'; END IF;
   ELSE
     INSERT INTO promotions(id,code,kind,amount,minimum,starts_at,ends_at,usage_limit,active)
     VALUES(target,p_input->>'code',p_input->>'kind',(p_input->>'amount')::integer,(p_input->>'minimum')::integer,
       (p_input->>'startsAt')::timestamptz,(p_input->>'endsAt')::timestamptz,(p_input->>'usageLimit')::integer,(p_input->>'active')::boolean);
   END IF;
 ELSIF action = 'settings.save' THEN
   target := '00000000-0000-4000-8000-000000000001';
   INSERT INTO store_settings(id,name,email,phone,address,shipping_fee)
   VALUES(1,p_input->>'name',p_input->>'email',p_input->>'phone',p_input->>'address',(p_input->>'shippingFee')::integer)
   ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,phone=excluded.phone,address=excluded.address,shipping_fee=excluded.shipping_fee,updated_at=clock_timestamp();
 ELSIF action = 'order.create' THEN
   target := p_request;
   SELECT * INTO STRICT customer FROM customers WHERE id=(p_input->>'customerId')::uuid AND active FOR UPDATE;
   IF jsonb_array_length(p_input->'items') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Invalid line count'; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(p_input->'items') LOOP
     quantity := (item->>'quantity')::integer;
     IF quantity NOT BETWEEN 1 AND 1000000 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
     SELECT v.*,p.name INTO STRICT variant FROM product_variants v JOIN products p ON p.id=v.product_id
       WHERE v.id=(item->>'variantId')::uuid AND v.status='active' AND p.status='active' AND v.currency='PHP' FOR UPDATE OF v,p;
     subtotal := subtotal + variant.price::bigint * quantity;
   END LOOP;
   IF nullif(p_input->>'promotionCode','') IS NOT NULL THEN
     SELECT * INTO STRICT promo FROM promotions WHERE code=p_input->>'promotionCode' AND active
       AND starts_at <= clock_timestamp() AND ends_at > clock_timestamp() AND used < usage_limit AND minimum <= subtotal FOR UPDATE;
     discount := CASE WHEN promo.kind='fixed' THEN least(promo.amount::bigint,subtotal) ELSE subtotal * promo.amount / 100 END;
     UPDATE promotions SET used=used+1,updated_at=clock_timestamp() WHERE id=promo.id;
   END IF;
   SELECT coalesce((SELECT shipping_fee FROM store_settings WHERE id=1),0) INTO shipping;
   INSERT INTO orders(id,customer_id,location_id,customer_snapshot,subtotal,discount,shipping_fee,total,promotion_id,promotion_code,notes,actor_id)
   VALUES(target,customer.id,(p_input->>'locationId')::uuid,jsonb_build_object('name',customer.name,'email',customer.email,'phone',customer.phone,'address',customer.address),
     subtotal,discount,shipping,subtotal-discount+shipping,promo.id,promo.code,p_input->>'notes',p_actor);
   -- Stable SKU order agrees with inventory balance lock order.
   FOR item IN SELECT value FROM jsonb_array_elements(p_input->'items') ORDER BY value->>'variantId' LOOP
     SELECT v.*,p.name INTO STRICT variant FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=(item->>'variantId')::uuid;
     reservation := gen_random_uuid();
     PERFORM inventory_apply(reservation,variant.id,(p_input->>'locationId')::uuid,'RESERVATION',(item->>'quantity')::integer,'Order reservation',target::text,NULL,p_actor);
     INSERT INTO order_items(order_id,variant_id,reservation_id,sku,name,quantity,unit_price,unit_cost)
     VALUES(target,variant.id,reservation,variant.sku,variant.name,(item->>'quantity')::integer,variant.price,variant.cost);
   END LOOP;
 ELSIF action IN ('order.pay','order.refund','order.fulfill','order.cancel') THEN
   SELECT * INTO STRICT ord FROM orders WHERE id=target FOR UPDATE;
   IF ord.status <> 'pending' THEN RAISE EXCEPTION 'Order is already closed'; END IF;
   IF action='order.pay' THEN
     IF ord.payment_status <> 'unpaid' OR length(trim(p_input->>'reference')) < 3 THEN RAISE EXCEPTION 'Invalid payment transition'; END IF;
     UPDATE orders SET payment_status='paid',payment_reference=p_input->>'reference',updated_at=clock_timestamp() WHERE id=target;
   ELSIF action='order.refund' THEN
     IF ord.payment_status <> 'paid' OR length(trim(p_input->>'reference')) < 3 THEN RAISE EXCEPTION 'Invalid refund transition'; END IF;
     UPDATE orders SET payment_status='refunded',payment_reference=p_input->>'reference',updated_at=clock_timestamp() WHERE id=target;
   ELSE
     IF action='order.fulfill' AND ord.payment_status <> 'paid' THEN RAISE EXCEPTION 'Record payment before fulfillment'; END IF;
     IF action='order.cancel' AND ord.payment_status='paid' THEN RAISE EXCEPTION 'Record refund before cancellation'; END IF;
     FOR line IN SELECT * FROM order_items WHERE order_id=target ORDER BY variant_id LOOP
       PERFORM inventory_apply(gen_random_uuid(),line.variant_id,ord.location_id,
         (CASE WHEN action='order.fulfill' THEN 'SALE' ELSE 'RESERVATION_RELEASE' END)::inventory_movement_type,
         line.quantity,CASE WHEN action='order.fulfill' THEN 'Order fulfillment' ELSE 'Order cancellation' END,target::text,line.reservation_id,p_actor);
     END LOOP;
     UPDATE orders SET status=CASE WHEN action='order.fulfill' THEN 'fulfilled' ELSE 'cancelled' END,updated_at=clock_timestamp() WHERE id=target;
     IF action='order.cancel' AND ord.promotion_id IS NOT NULL THEN UPDATE promotions SET used=used-1,updated_at=clock_timestamp() WHERE id=ord.promotion_id; END IF;
   END IF;
 ELSE RAISE EXCEPTION 'Unknown commerce action'; END IF;
 INSERT INTO commerce_audit(request_id,actor_id,entity_id,action,payload) VALUES(p_request,p_actor,target,action,p_input);
 RETURN target;
END;
$$;

--> statement-breakpoint
-- Existing reservations must remain fulfillable/releasable after catalog deactivation.
CREATE OR REPLACE FUNCTION inventory_apply(
 p_request uuid, p_variant uuid, p_location uuid, p_type inventory_movement_type,
 p_quantity integer, p_reason text, p_reference text, p_reservation uuid, p_actor text, p_reversal uuid
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
      prior.actor_id <> p_actor OR prior.reversal_of_id IS DISTINCT FROM p_reversal OR
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
                WHERE v.id = p_variant AND ((v.status = 'active' AND p.status <> 'archived')
                  OR (p_reservation IS NOT NULL AND p_type IN ('SALE','RESERVATION_RELEASE')))) THEN
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
   before_on_hand, after_on_hand, before_reserved, after_reserved, reservation_id, reason, reference, actor_id, reversal_of_id)
 VALUES(p_request, p_variant, p_location, p_type, p_quantity, b.on_hand, new_hand, b.reserved,
   new_reserved, reservation_id, p_reason, p_reference, p_actor, p_reversal) RETURNING id INTO movement_id;
 RETURN movement_id;
END;
$$;
