CREATE TABLE "inventory_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"default_mode" text DEFAULT 'availability_only' NOT NULL,
	CONSTRAINT "inventory_settings_valid" CHECK ("inventory_settings"."id" = 1 AND "inventory_settings"."default_mode" IN ('counted', 'availability_only'))
);
--> statement-breakpoint
ALTER TABLE "order_items" ALTER COLUMN "reservation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "inventory_mode" text DEFAULT 'counted' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "sales_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_inventory_mode" CHECK ("product_variants"."inventory_mode" IN ('counted', 'availability_only'));
--> statement-breakpoint
CREATE FUNCTION inventory_default_mode() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce((select default_mode from inventory_settings where id=1), 'availability_only'); $$;
--> statement-breakpoint
ALTER TABLE product_variants ALTER COLUMN inventory_mode SET DEFAULT inventory_default_mode();

--> statement-breakpoint
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
 PERFORM 1 FROM product_variants WHERE id=p_variant FOR UPDATE;
 IF NOT EXISTS (SELECT 1 FROM product_variants WHERE id=p_variant AND inventory_mode='counted') THEN
   RAISE EXCEPTION 'Stock counting is disabled for this SKU';
 END IF;
 IF p_type='RESERVATION' OR (p_type='SALE' AND p_reservation IS NULL) THEN
   IF NOT EXISTS(SELECT 1 FROM product_variants WHERE id=p_variant AND sales_enabled) THEN RAISE EXCEPTION 'Item is not available'; END IF;
 END IF;
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

--> statement-breakpoint
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
       WHERE NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.id=(i->>'variantId')::uuid AND v.sales_enabled AND
         (v.inventory_mode='availability_only' OR EXISTS(SELECT 1 FROM inventory_balances b WHERE b.location_id=l.id AND b.variant_id=v.id AND b.on_hand-b.reserved >= (i->>'quantity')::integer)))) ORDER BY l.id LIMIT 1;
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
       WHERE v.id=(item->>'variantId')::uuid AND v.status='active' AND p.status='active' AND v.currency='PHP' AND v.sales_enabled FOR UPDATE OF v,p;
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
     reservation := NULL;
     IF variant.inventory_mode='counted' THEN
     reservation := gen_random_uuid();
     PERFORM inventory_apply(reservation,variant.id,coalesce(guest_location,(p_input->>'locationId')::uuid),'RESERVATION',(item->>'quantity')::integer,'Order reservation',target::text,NULL,p_actor);
     END IF;
     INSERT INTO order_items(order_id,variant_id,reservation_id,sku,name,quantity,unit_price,unit_cost)
     VALUES(target,variant.id,reservation,variant.sku,variant.name,(item->>'quantity')::integer,variant.price,variant.cost);
   END LOOP;
 ELSIF action IN ('order.pay','order.refund','order.fulfill','order.cancel','order.confirm','order.reject','order.ready','order.ship') THEN
   SELECT * INTO STRICT ord FROM orders WHERE id=target FOR UPDATE;
   IF action IN ('order.confirm','order.reject') THEN
     IF ord.status <> 'awaiting_confirmation' THEN RAISE EXCEPTION 'Order is not awaiting confirmation'; END IF;
   ELSIF action IN ('order.ready','order.ship') THEN
     IF ord.status <> 'confirmed' THEN RAISE EXCEPTION 'Order must be confirmed first'; END IF;
   ELSIF ord.status NOT IN ('pending','confirmed','ready_for_pickup','out_for_delivery') AND NOT (action='order.cancel' AND ord.status='awaiting_confirmation' AND ord.fulfillment_method='pickup' AND ord.pickup_payment='upon_pickup' AND ord.payment_status='unpaid') THEN RAISE EXCEPTION 'Order is already closed'; END IF;
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
     FOR line IN SELECT * FROM order_items WHERE order_id=target AND reservation_id IS NOT NULL ORDER BY variant_id LOOP
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
    FOR line IN SELECT * FROM order_items WHERE order_id=ord.id AND reservation_id IS NOT NULL ORDER BY variant_id LOOP
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

--> statement-breakpoint
CREATE OR REPLACE FUNCTION pos_execute(p_actor text, p_request uuid, p_input jsonb) RETURNS uuid LANGUAGE plpgsql VOLATILE AS $$
DECLARE prior commerce_audit%ROWTYPE; target uuid := p_request; item jsonb; variant record;
  reservation uuid; subtotal bigint := 0; quantity integer; tendered integer; change integer;
  method text := p_input->>'paymentMethod'; customer_name text := nullif(trim(p_input->>'customerName'),'');
BEGIN
  IF p_actor IS NULL OR p_input->>'action' <> 'pos.sale' OR p_input->>'requestId' <> p_request::text THEN
    RAISE EXCEPTION 'Invalid POS request';
  END IF;
  SELECT * INTO prior FROM commerce_audit WHERE request_id=p_request;
  IF FOUND THEN
    IF prior.actor_id IS DISTINCT FROM p_actor OR prior.payload <> p_input THEN RAISE EXCEPTION 'Request already used'; END IF;
    RETURN prior.entity_id;
  END IF;
  IF method NOT IN ('cash','gcash','card','bank_transfer') OR
     jsonb_typeof(p_input->'items') <> 'array' OR jsonb_array_length(p_input->'items') NOT BETWEEN 1 AND 50 OR
     (SELECT count(DISTINCT value->>'variantId') FROM jsonb_array_elements(p_input->'items')) <> jsonb_array_length(p_input->'items') OR
     length(coalesce(customer_name,'')) > 160 OR
     NOT EXISTS (SELECT 1 FROM inventory_locations WHERE id=(p_input->>'locationId')::uuid) THEN
    RAISE EXCEPTION 'Invalid POS sale details';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_input->'items') ORDER BY value->>'variantId' LOOP
    quantity := (item->>'quantity')::integer;
    IF quantity NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Invalid sale quantity'; END IF;
    SELECT v.*,p.name AS product_name INTO STRICT variant FROM product_variants v
      JOIN products p ON p.id=v.product_id
      WHERE v.id=(item->>'variantId')::uuid AND v.status='active' AND p.status='active' AND v.currency='PHP' AND v.sales_enabled
      FOR UPDATE OF v,p;
    subtotal := subtotal + variant.price::bigint * quantity;
  END LOOP;
  IF subtotal < 1 OR subtotal > 2147483647 THEN RAISE EXCEPTION 'Invalid sale total'; END IF;
  tendered := CASE WHEN method='cash' THEN (p_input->>'amountTendered')::integer ELSE subtotal::integer END;
  IF tendered < subtotal OR tendered > 2147483647 THEN RAISE EXCEPTION 'Payment does not cover sale total'; END IF;
  change := tendered - subtotal::integer;
  INSERT INTO orders(id,customer_id,location_id,channel,status,payment_status,fulfillment_method,
    customer_snapshot,subtotal,discount,shipping_fee,total,notes,actor_id,payment_method,amount_tendered,change_due)
  VALUES(target,NULL,(p_input->>'locationId')::uuid,'pos','fulfilled','paid','pickup',
    jsonb_build_object('name',coalesce(customer_name,'Walk-in customer'),'email','','phone','','address','In-store purchase'),
    subtotal,0,0,subtotal,'In-store sale',p_actor,method,tendered,change);
  FOR item IN SELECT value FROM jsonb_array_elements(p_input->'items') ORDER BY value->>'variantId' LOOP
    quantity := (item->>'quantity')::integer;
    SELECT v.*,p.name AS product_name INTO STRICT variant FROM product_variants v JOIN products p ON p.id=v.product_id
      WHERE v.id=(item->>'variantId')::uuid;
    reservation := NULL;
    IF variant.inventory_mode='counted' THEN
    reservation := gen_random_uuid();
    PERFORM inventory_apply(reservation,variant.id,(p_input->>'locationId')::uuid,'RESERVATION',quantity,
      'POS sale reservation',target::text,NULL,p_actor);
    PERFORM inventory_apply(gen_random_uuid(),variant.id,(p_input->>'locationId')::uuid,'SALE',quantity,
      'Point of sale',target::text,reservation,p_actor);
    END IF;
    INSERT INTO order_items(order_id,variant_id,reservation_id,sku,name,quantity,unit_price,unit_cost)
      VALUES(target,variant.id,reservation,variant.sku,variant.product_name,quantity,variant.price,variant.cost);
  END LOOP;
  INSERT INTO commerce_audit(request_id,actor_id,entity_id,action,payload)
    VALUES(p_request,p_actor,target,'pos.sale',p_input);
  RETURN target;
END;
$$;

--> statement-breakpoint
CREATE FUNCTION guard_inventory_mode_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.inventory_mode IS DISTINCT FROM OLD.inventory_mode THEN
   IF EXISTS(SELECT 1 FROM inventory_reservations WHERE variant_id=OLD.id AND remaining>0)
     OR EXISTS(SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.variant_id=OLD.id AND o.status NOT IN ('fulfilled','cancelled')) THEN
     RAISE EXCEPTION 'Finish or cancel open orders and reservations before changing stock counting';
   END IF;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER inventory_mode_transition BEFORE UPDATE OF inventory_mode ON product_variants FOR EACH ROW EXECUTE FUNCTION guard_inventory_mode_change();
--> statement-breakpoint
CREATE FUNCTION inventory_configure(p_actor text, p_variant uuid, p_mode text, p_enabled boolean, p_counts jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v product_variants%ROWTYPE; loc record; target_count integer; current_count integer; delta integer;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Access denied'; END IF;
 SELECT * INTO STRICT v FROM product_variants WHERE id=p_variant FOR UPDATE;
 IF p_mode NOT IN ('counted','availability_only') OR p_enabled IS NULL THEN RAISE EXCEPTION 'Choose an inventory mode and availability'; END IF;
 IF p_mode='counted' AND v.inventory_mode<>'counted' THEN
   FOR loc IN SELECT id FROM inventory_locations ORDER BY id LOOP
     IF NOT coalesce(p_counts ? loc.id::text,false) OR coalesce(p_counts->>loc.id::text,'') !~ '^\d+$' THEN
       RAISE EXCEPTION 'Enter a physical stock count for every location before enabling counting';
     END IF;
     target_count := (p_counts->>loc.id::text)::integer;
     IF target_count NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'Physical counts must be between 0 and 1000000'; END IF;
   END LOOP;
 END IF;
 UPDATE product_variants SET inventory_mode=p_mode,sales_enabled=p_enabled,updated_at=clock_timestamp() WHERE id=p_variant;
 IF p_mode='counted' AND v.inventory_mode<>'counted' THEN
   FOR loc IN SELECT id FROM inventory_locations ORDER BY id LOOP
     SELECT coalesce((SELECT on_hand FROM inventory_balances WHERE variant_id=p_variant AND location_id=loc.id),0) INTO current_count;
     target_count := (p_counts->>loc.id::text)::integer;
     delta := target_count-current_count;
     IF delta<>0 THEN
       PERFORM inventory_apply(gen_random_uuid(),p_variant,loc.id,(CASE WHEN delta>0 THEN 'ADJUSTMENT_IN' ELSE 'ADJUSTMENT_OUT' END)::inventory_movement_type,
         abs(delta),'Physical count when enabling stock counting','Inventory mode change',NULL,p_actor);
     END IF;
   END LOOP;
 END IF;
 INSERT INTO catalog_audit(actor_id,product_id,action,changes) VALUES(p_actor,v.product_id,'update',
   jsonb_build_object('fields',jsonb_build_array('inventoryMode','salesEnabled'),'variantId',v.id,'before',jsonb_build_object('mode',v.inventory_mode,'available',v.sales_enabled),
     'after',jsonb_build_object('mode',p_mode,'available',p_enabled),'physicalCounts',coalesce(p_counts,'{}'::jsonb)));
 RETURN p_variant;
END; $$;
