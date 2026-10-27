ALTER TABLE "inventory_movements" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_audit" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "actor_id" DROP NOT NULL;
--> statement-breakpoint
-- Guest orders share the atomic pricing, promotion, reservation and fulfillment engine.
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
