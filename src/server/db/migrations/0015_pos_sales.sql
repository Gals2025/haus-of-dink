ALTER TABLE "orders" DROP CONSTRAINT "orders_valid";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "customer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "channel" text DEFAULT 'ecommerce' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "amount_tendered" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "change_due" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_valid" CHECK ("orders"."status" IN ('pending','awaiting_confirmation','confirmed','ready_for_pickup','out_for_delivery','fulfilled','cancelled') AND "orders"."payment_status" IN ('unpaid','paid','refunded') AND "orders"."fulfillment_method" IN ('delivery','pickup') AND ("orders"."pickup_payment" IS NULL OR "orders"."pickup_payment" IN ('online','upon_pickup')) AND ("orders"."status" <> 'fulfilled' OR "orders"."payment_status" = 'paid') AND ("orders"."status" <> 'cancelled' OR "orders"."payment_status" <> 'paid') AND "orders"."subtotal" >= 0 AND "orders"."discount" >= 0 AND "orders"."discount" <= "orders"."subtotal" AND "orders"."shipping_fee" >= 0 AND "orders"."total" = "orders"."subtotal" - "orders"."discount" + "orders"."shipping_fee" AND "orders"."channel" IN ('ecommerce','pos') AND ("orders"."channel" <> 'pos' OR ("orders"."customer_id" IS NULL AND "orders"."actor_id" IS NOT NULL AND "orders"."status" = 'fulfilled' AND "orders"."payment_status" = 'paid')) AND ("orders"."payment_method" IS NULL OR "orders"."payment_method" IN ('cash','gcash','card','bank_transfer')) AND "orders"."change_due" >= 0 AND ("orders"."amount_tendered" IS NULL OR "orders"."amount_tendered" >= "orders"."total"));
--> statement-breakpoint
-- Point-of-sale orders and their stock movements commit together. The request UUID
-- is both the idempotency key and the resulting order ID.
CREATE FUNCTION pos_execute(p_actor text, p_request uuid, p_input jsonb) RETURNS uuid LANGUAGE plpgsql VOLATILE AS $$
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
      WHERE v.id=(item->>'variantId')::uuid AND v.status='active' AND p.status='active' AND v.currency='PHP'
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
    reservation := gen_random_uuid();
    PERFORM inventory_apply(reservation,variant.id,(p_input->>'locationId')::uuid,'RESERVATION',quantity,
      'POS sale reservation',target::text,NULL,p_actor);
    PERFORM inventory_apply(gen_random_uuid(),variant.id,(p_input->>'locationId')::uuid,'SALE',quantity,
      'Point of sale',target::text,reservation,p_actor);
    INSERT INTO order_items(order_id,variant_id,reservation_id,sku,name,quantity,unit_price,unit_cost)
      VALUES(target,variant.id,reservation,variant.sku,variant.name,quantity,variant.price,variant.cost);
  END LOOP;
  INSERT INTO commerce_audit(request_id,actor_id,entity_id,action,payload)
    VALUES(p_request,p_actor,target,'pos.sale',p_input);
  RETURN target;
END;
$$;
