ALTER TABLE "customers" DROP CONSTRAINT "customers_valid";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_valid";--> statement-breakpoint
ALTER TABLE "inventory_movements" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_audit" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfillment_method" text DEFAULT 'delivery' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pickup_payment" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_proof_path" varchar(500);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "hold_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "rejection_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_valid" CHECK (length(trim("customers"."name")) > 0 AND ("customers"."email" IS NULL OR ("customers"."email" = lower(trim("customers"."email")) AND length("customers"."email") > 3)));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_valid" CHECK ("orders"."status" IN ('pending','awaiting_confirmation','confirmed','ready_for_pickup','out_for_delivery','fulfilled','cancelled') AND "orders"."payment_status" IN ('unpaid','paid','refunded') AND "orders"."fulfillment_method" IN ('delivery','pickup') AND ("orders"."pickup_payment" IS NULL OR "orders"."pickup_payment" IN ('online','upon_pickup')) AND ("orders"."status" <> 'fulfilled' OR "orders"."payment_status" = 'paid') AND ("orders"."status" <> 'cancelled' OR "orders"."payment_status" <> 'paid') AND "orders"."subtotal" >= 0 AND "orders"."discount" >= 0 AND "orders"."discount" <= "orders"."subtotal" AND "orders"."shipping_fee" >= 0 AND "orders"."total" = "orders"."subtotal" - "orders"."discount" + "orders"."shipping_fee");--> statement-breakpoint
CREATE INDEX "orders_pickup_expiry_idx" ON "orders" ("hold_expires_at") WHERE "status" IN ('awaiting_confirmation','confirmed') AND "payment_status" = 'unpaid';--> statement-breakpoint
CREATE OR REPLACE FUNCTION apply_guest_checkout_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE meta jsonb;
BEGIN
  IF NEW.actor_id IS NULL THEN
    meta := NEW.customer_snapshot;
    IF meta ? '__fulfillment' THEN
      NEW.fulfillment_method := meta->>'__fulfillment';
      NEW.pickup_payment := nullif(meta->>'__pickupPayment','');
      NEW.payment_proof_path := nullif(meta->>'__proofPath','');
      NEW.status := 'awaiting_confirmation';
      NEW.confirmed_at := NULL;
      IF NEW.fulfillment_method = 'pickup' THEN
        NEW.shipping_fee := 0;
        NEW.hold_expires_at := CASE WHEN NEW.pickup_payment='upon_pickup' THEN clock_timestamp()+interval '24 hours' ELSE NULL END;
      END IF;
      IF (NEW.fulfillment_method='delivery' AND (NEW.pickup_payment IS NOT NULL OR length(trim(meta->>'address'))<5 OR NEW.payment_proof_path IS NULL OR NEW.payment_proof_path !~ '^payment-proofs/[0-9a-f-]{36}$'))
        OR (NEW.fulfillment_method='pickup' AND ((meta->>'address')<>'' OR NEW.pickup_payment IS NULL OR (NEW.pickup_payment='online' AND (NEW.payment_proof_path IS NULL OR NEW.payment_proof_path !~ '^payment-proofs/[0-9a-f-]{36}$'))))
        OR (NEW.fulfillment_method='pickup' AND NEW.pickup_payment='upon_pickup' AND NEW.payment_proof_path IS NOT NULL) THEN
        RAISE EXCEPTION 'Invalid fulfillment or payment details';
      END IF;
      NEW.total := NEW.subtotal-NEW.discount+NEW.shipping_fee;
      NEW.customer_snapshot := meta - '__fulfillment' - '__pickupPayment' - '__proofPath' - '__emailOptional';
      IF meta->>'__emailOptional'='true' THEN NEW.customer_snapshot := jsonb_set(NEW.customer_snapshot,'{email}','""'::jsonb,true); END IF;
      IF NEW.fulfillment_method='pickup' THEN NEW.customer_snapshot := jsonb_set(NEW.customer_snapshot,'{address}','""'::jsonb,true); END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER "orders_checkout_metadata" BEFORE INSERT ON "orders" FOR EACH ROW EXECUTE FUNCTION apply_guest_checkout_metadata();--> statement-breakpoint
CREATE OR REPLACE FUNCTION null_guest_customer_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.actor_id IS NULL AND NEW.customer_snapshot->>'email'='' THEN
    UPDATE customers SET email=NULL WHERE id=NEW.customer_id AND email LIKE 'guest-%@checkout.invalid';
  END IF;
  RETURN NEW;
END; $$;--> statement-breakpoint
CREATE TRIGGER "orders_guest_customer_email" AFTER INSERT ON "orders" FOR EACH ROW EXECUTE FUNCTION null_guest_customer_email();--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce_execute(p_actor text, p_request uuid, p_input jsonb) RETURNS uuid LANGUAGE plpgsql VOLATILE AS $$
DECLARE
 action text := p_input->>'action'; target uuid; prior commerce_audit%ROWTYPE;
 customer customers%ROWTYPE; promo promotions%ROWTYPE; ord orders%ROWTYPE;
 item jsonb; variant record; line record; reservation uuid;
 guest_customer uuid; guest_location uuid;
 subtotal bigint := 0; discount bigint := 0; shipping integer := 0; quantity integer;
BEGIN
 SELECT * INTO prior FROM commerce_audit WHERE request_id = p_request;
 IF FOUND THEN
   IF prior.actor_id IS DISTINCT FROM p_actor OR prior.payload <> p_input THEN RAISE EXCEPTION 'Request already used'; END IF;
   RETURN prior.entity_id;
 END IF;
 IF (p_actor IS NULL AND action <> 'order.guest') OR (p_actor IS NOT NULL AND action = 'order.guest') THEN
   RAISE EXCEPTION 'Invalid checkout actor';
 END IF;
 IF action = 'order.guest' THEN
   IF (SELECT count(*) FROM orders WHERE actor_id IS NULL
       AND (customer_snapshot->>'email' = p_input->'contact'->>'email' OR customer_snapshot->>'phone' = p_input->'contact'->>'phone')
       AND created_at > clock_timestamp() - interval '1 hour') >= 3 THEN
     RAISE EXCEPTION 'Checkout limit reached';
   END IF;
   -- Never overwrite an existing customer's contact details based on an unverified email.
   INSERT INTO customers(name,email,phone,address) VALUES(p_input->'contact'->>'name',p_input->'contact'->>'email',p_input->'contact'->>'phone',p_input->'contact'->>'address')
     ON CONFLICT (lower(email)) DO NOTHING;
   SELECT id INTO STRICT guest_customer FROM customers WHERE email=p_input->'contact'->>'email' AND active;
   -- The server chooses one location that can supply every requested SKU.
   SELECT l.id INTO guest_location FROM inventory_locations l
     WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_input->'items') i
       WHERE NOT EXISTS (SELECT 1 FROM inventory_balances b WHERE b.location_id=l.id AND b.variant_id=(i->>'variantId')::uuid
         AND b.on_hand-b.reserved >= (i->>'quantity')::integer)) ORDER BY l.id LIMIT 1;
   IF guest_location IS NULL THEN RAISE EXCEPTION 'Stock unavailable'; END IF;
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
 ELSIF action IN ('order.create','order.guest') THEN
   target := p_request;
   SELECT * INTO STRICT customer FROM customers WHERE id=coalesce(guest_customer,(p_input->>'customerId')::uuid) AND active FOR UPDATE;
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
   VALUES(target,customer.id,coalesce(guest_location,(p_input->>'locationId')::uuid),CASE WHEN action='order.guest' THEN p_input->'contact' ELSE jsonb_build_object('name',customer.name,'email',customer.email,'phone',customer.phone,'address',customer.address) END,
     subtotal,discount,shipping,subtotal-discount+shipping,promo.id,promo.code,p_input->>'notes',p_actor);
   -- Stable SKU order agrees with inventory balance lock order.
   FOR item IN SELECT value FROM jsonb_array_elements(p_input->'items') ORDER BY value->>'variantId' LOOP
     SELECT v.*,p.name INTO STRICT variant FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=(item->>'variantId')::uuid;
     reservation := gen_random_uuid();
     PERFORM inventory_apply(reservation,variant.id,coalesce(guest_location,(p_input->>'locationId')::uuid),'RESERVATION',(item->>'quantity')::integer,'Order reservation',target::text,NULL,p_actor);
     INSERT INTO order_items(order_id,variant_id,reservation_id,sku,name,quantity,unit_price,unit_cost)
     VALUES(target,variant.id,reservation,variant.sku,variant.name,(item->>'quantity')::integer,variant.price,variant.cost);
   END LOOP;
 ELSIF action IN ('order.pay','order.refund','order.fulfill','order.cancel','order.confirm','order.reject','order.ready','order.ship') THEN
   SELECT * INTO STRICT ord FROM orders WHERE id=target FOR UPDATE;
   IF action IN ('order.confirm','order.reject') THEN
     IF ord.status <> 'awaiting_confirmation' THEN RAISE EXCEPTION 'Order is not awaiting confirmation'; END IF;
   ELSIF action IN ('order.ready','order.ship') THEN
     IF ord.status <> 'confirmed' THEN RAISE EXCEPTION 'Order must be confirmed first'; END IF;
   ELSIF ord.status NOT IN ('pending','confirmed','ready_for_pickup','out_for_delivery') THEN RAISE EXCEPTION 'Order is already closed'; END IF;
   IF action='order.confirm' THEN
     UPDATE orders SET status='confirmed',confirmed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=target;
   ELSIF action='order.pay' THEN
     IF ord.payment_status <> 'unpaid' OR length(trim(p_input->>'reference')) < 3 THEN RAISE EXCEPTION 'Invalid payment transition'; END IF;
     UPDATE orders SET payment_status='paid',payment_reference=p_input->>'reference',updated_at=clock_timestamp() WHERE id=target;
   ELSIF action='order.refund' THEN
     IF ord.payment_status <> 'paid' OR length(trim(p_input->>'reference')) < 3 THEN RAISE EXCEPTION 'Invalid refund transition'; END IF;
     UPDATE orders SET payment_status='refunded',payment_reference=p_input->>'reference',updated_at=clock_timestamp() WHERE id=target;
   ELSIF action='order.ready' THEN
     IF ord.fulfillment_method<>'pickup' OR ord.status<>'confirmed' OR ord.payment_status<>'paid' THEN RAISE EXCEPTION 'Order is not ready for pickup'; END IF;
     UPDATE orders SET status='ready_for_pickup',updated_at=clock_timestamp() WHERE id=target;
   ELSIF action='order.ship' THEN
     IF ord.fulfillment_method<>'delivery' OR ord.status<>'confirmed' OR ord.payment_status<>'paid' THEN RAISE EXCEPTION 'Order is not ready for delivery'; END IF;
     UPDATE orders SET status='out_for_delivery',updated_at=clock_timestamp() WHERE id=target;
   ELSE
     IF action='order.reject' AND ord.payment_status='paid' THEN RAISE EXCEPTION 'Refund paid orders before rejection'; END IF;
     IF action='order.fulfill' AND ord.payment_status <> 'paid' THEN RAISE EXCEPTION 'Record payment before fulfillment'; END IF;
     IF action='order.cancel' AND ord.payment_status='paid' THEN RAISE EXCEPTION 'Record refund before cancellation'; END IF;
     FOR line IN SELECT * FROM order_items WHERE order_id=target ORDER BY variant_id LOOP
       PERFORM inventory_apply(gen_random_uuid(),line.variant_id,ord.location_id,
         (CASE WHEN action='order.fulfill' THEN 'SALE' ELSE 'RESERVATION_RELEASE' END)::inventory_movement_type,
         line.quantity,CASE WHEN action='order.fulfill' THEN 'Order fulfillment' ELSE 'Order cancellation' END,target::text,line.reservation_id,p_actor);
     END LOOP;
     UPDATE orders SET status=CASE WHEN action='order.fulfill' THEN 'fulfilled' ELSE 'cancelled' END, rejection_reason=CASE WHEN action='order.reject' THEN left(coalesce(nullif(trim(p_input->>'reason'),''),'Order could not be confirmed.'),500) ELSE rejection_reason END,updated_at=clock_timestamp() WHERE id=target;
     IF action IN ('order.cancel','order.reject') AND ord.promotion_id IS NOT NULL THEN UPDATE promotions SET used=used-1,updated_at=clock_timestamp() WHERE id=ord.promotion_id; END IF;
   END IF;
 ELSE RAISE EXCEPTION 'Unknown commerce action'; END IF;
 INSERT INTO commerce_audit(request_id,actor_id,entity_id,action,payload) VALUES(p_request,p_actor,target,action,p_input);
 RETURN target;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION expire_pickup_orders() RETURNS integer LANGUAGE plpgsql VOLATILE AS $$
DECLARE ord orders%ROWTYPE; line record; expired_count integer := 0; req uuid;
BEGIN
  FOR ord IN SELECT * FROM orders WHERE fulfillment_method='pickup' AND pickup_payment='upon_pickup'
    AND payment_status='unpaid' AND status IN ('awaiting_confirmation','confirmed')
    AND hold_expires_at <= clock_timestamp() ORDER BY hold_expires_at FOR UPDATE SKIP LOCKED LOOP
    FOR line IN SELECT * FROM order_items WHERE order_id=ord.id ORDER BY variant_id LOOP
      PERFORM inventory_apply(gen_random_uuid(),line.variant_id,ord.location_id,'RESERVATION_RELEASE',line.quantity,
        'Pickup reservation expired',ord.id::text,line.reservation_id,NULL);
    END LOOP;
    UPDATE orders SET status='cancelled',rejection_reason='Pickup reservation expired after 24 hours.',updated_at=clock_timestamp() WHERE id=ord.id;
    IF ord.promotion_id IS NOT NULL THEN UPDATE promotions SET used=greatest(0,used-1),updated_at=clock_timestamp() WHERE id=ord.promotion_id; END IF;
    req := gen_random_uuid();
    INSERT INTO commerce_audit(request_id,actor_id,entity_id,action,payload)
      VALUES(req,NULL,ord.id,'order.expire','{"reason":"pickup_hold_timeout"}'::jsonb);
    expired_count := expired_count+1;
  END LOOP;
  RETURN expired_count;
END; $$;
