CREATE TABLE "stock_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost" integer NOT NULL,
	"counted" integer NOT NULL,
	"movement_request_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	CONSTRAINT "stock_receipt_lines_movement_request_id_unique" UNIQUE("movement_request_id"),
	CONSTRAINT "receipt_line_valid" CHECK ("stock_receipt_lines"."quantity" between 1 and 1000000 AND "stock_receipt_lines"."unit_cost" >= 0 AND "stock_receipt_lines"."counted" IN (0,1))
);
--> statement-breakpoint
CREATE TABLE "stock_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"supplier_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"delivery_date" date NOT NULL,
	"reference" text NOT NULL,
	"actor_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_valuations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"before_value" bigint,
	"after_value" bigint NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valuation_valid" CHECK ("stock_valuations"."after_value" >= 0 AND length(trim("stock_valuations"."reason")) between 3 and 500)
);
--> statement-breakpoint
CREATE TABLE "supplier_items" (
	"supplier_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"purchase_code" text DEFAULT '' NOT NULL,
	"default_cost" integer,
	CONSTRAINT "supplier_items_supplier_id_variant_id_pk" PRIMARY KEY("supplier_id","variant_id"),
	CONSTRAINT "supplier_item_valid" CHECK (length("supplier_items"."purchase_code") <= 100 AND ("supplier_items"."default_cost" IS NULL OR "supplier_items"."default_cost" >= 0))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	CONSTRAINT "supplier_name_valid" CHECK (length(trim("suppliers"."name")) between 1 and 160 AND length("suppliers"."contact") <= 500)
);
--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD COLUMN "stock_value" bigint DEFAULT 0;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "cost_total" bigint;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "cost_total" bigint;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "cost_basis" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD CONSTRAINT "stock_receipt_lines_receipt_id_stock_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."stock_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipt_lines" ADD CONSTRAINT "stock_receipt_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "stock_receipts_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_valuations" ADD CONSTRAINT "stock_valuations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_valuations" ADD CONSTRAINT "stock_valuations_location_id_inventory_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_valuations" ADD CONSTRAINT "stock_valuations_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_variant_unique" ON "stock_receipt_lines" USING btree ("receipt_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_name_unique" ON "suppliers" USING btree (lower(trim("name")));
--> statement-breakpoint
-- Existing quantities retain their reference valuation; missing costs remain unknown.
UPDATE inventory_balances b SET stock_value=CASE WHEN b.on_hand=0 THEN 0 ELSE b.on_hand::bigint*v.cost END
FROM product_variants v WHERE v.id=b.variant_id;
--> statement-breakpoint
UPDATE order_items i SET cost_total=i.unit_cost::bigint*i.quantity,
 cost_basis=CASE WHEN i.unit_cost IS NULL THEN 'unknown' ELSE 'legacy' END
FROM orders o WHERE o.id=i.order_id AND o.status='fulfilled';
--> statement-breakpoint
CREATE SEQUENCE inventory_sku_sequence;
--> statement-breakpoint
CREATE FUNCTION purchasing_execute(p_actor text,p_request uuid,p_input jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE prior commerce_audit%ROWTYPE; target uuid; item jsonb; v product_variants%ROWTYPE;
 movement uuid; amount bigint; old_value bigint; generated_sku text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,1948402));
 SELECT * INTO prior FROM commerce_audit WHERE request_id=p_request;
 IF FOUND THEN
   IF prior.actor_id IS DISTINCT FROM p_actor OR prior.payload<>p_input THEN RAISE EXCEPTION 'Request already used'; END IF;
   RETURN prior.entity_id;
 END IF;
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Access denied'; END IF;
 CASE p_input->>'action'
 WHEN 'supplier.create' THEN
   INSERT INTO suppliers(name,contact) VALUES(trim(p_input->>'name'),coalesce(p_input->>'contact','')) RETURNING id INTO target;
 WHEN 'supplier.item' THEN
   target:=(p_input->>'variantId')::uuid;
   INSERT INTO supplier_items(supplier_id,variant_id,purchase_code,default_cost)
   VALUES((p_input->>'supplierId')::uuid,target,p_input->>'purchaseCode',(p_input->>'defaultCost')::integer)
   ON CONFLICT(supplier_id,variant_id) DO UPDATE SET purchase_code=excluded.purchase_code,default_cost=excluded.default_cost;
 WHEN 'product.create' THEN
   IF NOT EXISTS(SELECT 1 FROM brands WHERE id=(p_input->>'brandId')::uuid AND status='active') OR
     NOT EXISTS(SELECT 1 FROM categories WHERE id=(p_input->>'categoryId')::uuid AND status='active') THEN RAISE EXCEPTION 'Choose an active brand and category'; END IF;
   INSERT INTO products(name,slug,description,short_description,brand_id,category_id,status,featured,new_arrival)
   VALUES(p_input->>'name',p_input->>'slug',p_input->>'description',p_input->>'shortDescription',
     (p_input->>'brandId')::uuid,(p_input->>'categoryId')::uuid,(p_input->>'status')::product_status,
     (p_input->>'featured')::boolean,(p_input->>'newArrival')::boolean) RETURNING id INTO target;
   generated_sku:=nullif(trim(p_input->>'sku'),'');
   IF generated_sku IS NULL THEN
     LOOP
       generated_sku:=nextval('inventory_sku_sequence')::text;
       generated_sku:='SKU-'||lpad(generated_sku,greatest(8,length(generated_sku)),'0');
       EXIT WHEN NOT EXISTS(SELECT 1 FROM product_variants WHERE lower(sku)=lower(generated_sku));
     END LOOP;
   END IF;
   INSERT INTO product_variants(product_id,sku,price,inventory_mode)
   VALUES(target,generated_sku,(p_input->>'price')::integer,coalesce(nullif(p_input->>'inventoryMode','default'),inventory_default_mode())) RETURNING * INTO v;
   FOR item IN SELECT value FROM jsonb_array_elements(p_input->'suppliers') LOOP
     INSERT INTO supplier_items(supplier_id,variant_id,purchase_code,default_cost)
     VALUES((item->>'supplierId')::uuid,v.id,item->>'purchaseCode',(item->>'defaultCost')::integer);
   END LOOP;
   INSERT INTO catalog_audit(actor_id,product_id,action,changes) VALUES(p_actor,target,'create',jsonb_build_object('fields',jsonb_build_array('product','initialSKU'),'variantId',v.id));
 WHEN 'receipt.post' THEN
   target:=p_request;
   IF jsonb_array_length(p_input->'lines') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Choose 1 to 100 products'; END IF;
   -- Consistent SKU lock order prevents deadlocks with multi-item sales.
   PERFORM 1 FROM product_variants WHERE id IN (SELECT (value->>'variantId')::uuid FROM jsonb_array_elements(p_input->'lines')) ORDER BY id FOR UPDATE;
   INSERT INTO stock_receipts(id,supplier_id,location_id,delivery_date,reference,actor_id,payload)
   VALUES(target,(p_input->>'supplierId')::uuid,(p_input->>'locationId')::uuid,(p_input->>'deliveryDate')::date,p_input->>'reference',p_actor,p_input);
   FOR item IN SELECT value FROM jsonb_array_elements(p_input->'lines') ORDER BY value->>'variantId' LOOP
     SELECT pv.* INTO STRICT v FROM product_variants pv JOIN products p ON p.id=pv.product_id
       WHERE pv.id=(item->>'variantId')::uuid AND pv.status='active' AND p.status<>'archived' AND pv.currency='PHP';
     movement:=gen_random_uuid();
     INSERT INTO stock_receipt_lines(receipt_id,variant_id,quantity,unit_cost,counted,movement_request_id)
     VALUES(target,v.id,(item->>'quantity')::integer,(item->>'unitCost')::integer,CASE WHEN v.inventory_mode='counted' THEN 1 ELSE 0 END,movement);
     INSERT INTO supplier_items(supplier_id,variant_id) VALUES((p_input->>'supplierId')::uuid,v.id) ON CONFLICT DO NOTHING;
     IF v.inventory_mode='counted' THEN
       PERFORM inventory_apply(movement,v.id,(p_input->>'locationId')::uuid,'PURCHASE',(item->>'quantity')::integer,
         'Supplier delivery',target::text,NULL,p_actor);
     END IF;
   END LOOP;
 WHEN 'valuation.set' THEN
   target:=p_request;
   PERFORM 1 FROM product_variants WHERE id=(p_input->>'variantId')::uuid AND inventory_mode='counted' FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Only counted stock can be valued'; END IF;
   SELECT stock_value INTO STRICT old_value FROM inventory_balances WHERE variant_id=(p_input->>'variantId')::uuid AND location_id=(p_input->>'locationId')::uuid FOR UPDATE;
   amount:=(p_input->>'value')::bigint;
   IF amount<0 OR (amount<>0 AND EXISTS(SELECT 1 FROM inventory_balances WHERE variant_id=(p_input->>'variantId')::uuid AND location_id=(p_input->>'locationId')::uuid AND on_hand=0)) THEN RAISE EXCEPTION 'Empty stock must have zero value'; END IF;
   INSERT INTO stock_valuations(id,variant_id,location_id,before_value,after_value,reason,actor_id)
   VALUES(target,(p_input->>'variantId')::uuid,(p_input->>'locationId')::uuid,old_value,amount,p_input->>'reason',p_actor);
   UPDATE inventory_balances SET stock_value=amount,updated_at=clock_timestamp() WHERE variant_id=(p_input->>'variantId')::uuid AND location_id=(p_input->>'locationId')::uuid;
 ELSE RAISE EXCEPTION 'Unknown purchasing action';
 END CASE;
 INSERT INTO commerce_audit(request_id,actor_id,entity_id,action,payload) VALUES(p_request,p_actor,target,p_input->>'action',p_input);
 RETURN target;
END; $$;
--> statement-breakpoint
CREATE FUNCTION inventory_value_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_value bigint; incoming bigint; reference_cost integer;
BEGIN
 SELECT stock_value INTO STRICT current_value FROM inventory_balances WHERE variant_id=NEW.variant_id AND location_id=NEW.location_id FOR UPDATE;
 IF NEW.after_on_hand=NEW.before_on_hand THEN NEW.cost_total:=0; RETURN NEW; END IF;
 IF NEW.after_on_hand>NEW.before_on_hand THEN
   SELECT unit_cost::bigint*quantity INTO incoming FROM stock_receipt_lines WHERE movement_request_id=NEW.request_id;
   IF NOT FOUND AND NEW.reversal_of_id IS NOT NULL THEN
     SELECT cost_total INTO incoming FROM inventory_movements WHERE id=NEW.reversal_of_id;
   END IF;
   IF incoming IS NULL THEN
     IF NEW.before_on_hand>0 THEN incoming:=round(current_value::numeric*NEW.quantity/NEW.before_on_hand)::bigint;
     ELSE SELECT cost INTO reference_cost FROM product_variants WHERE id=NEW.variant_id; incoming:=reference_cost::bigint*NEW.quantity; END IF;
   END IF;
   NEW.cost_total:=incoming;
   current_value:=CASE WHEN NEW.before_on_hand=0 THEN incoming ELSE current_value+incoming END;
 ELSE
   NEW.cost_total:=CASE WHEN NEW.after_on_hand=0 THEN current_value ELSE round(current_value::numeric*NEW.quantity/NEW.before_on_hand)::bigint END;
   current_value:=CASE WHEN NEW.after_on_hand=0 THEN 0 ELSE current_value-NEW.cost_total END;
 END IF;
 UPDATE inventory_balances SET stock_value=current_value WHERE variant_id=NEW.variant_id AND location_id=NEW.location_id;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER inventory_valuation BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION inventory_value_movement();
--> statement-breakpoint
CREATE FUNCTION order_line_cost(p_variant uuid,p_reservation uuid,p_location uuid,p_quantity integer)
RETURNS TABLE(total bigint,basis text) LANGUAGE plpgsql AS $$
DECLARE unit integer;
BEGIN
 IF p_reservation IS NOT NULL THEN
   SELECT CASE WHEN count(*)=count(cost_total) THEN sum(cost_total)::bigint END INTO total FROM inventory_movements WHERE reservation_id=p_reservation AND type='SALE';
   basis:=CASE WHEN total IS NULL THEN 'unknown' ELSE 'weighted_average' END;
 ELSE
   SELECT l.unit_cost INTO unit FROM stock_receipt_lines l JOIN stock_receipts r ON r.id=l.receipt_id
    WHERE l.variant_id=p_variant AND r.location_id=p_location ORDER BY r.created_at DESC,r.id DESC LIMIT 1;
   IF NOT FOUND THEN SELECT cost INTO unit FROM product_variants WHERE id=p_variant; END IF;
   total:=unit::bigint*p_quantity; basis:=CASE WHEN total IS NULL THEN 'unknown' ELSE 'estimated' END;
 END IF;
 RETURN NEXT;
END; $$;
--> statement-breakpoint
CREATE FUNCTION order_cost_on_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE loc uuid;
BEGIN
 SELECT location_id INTO loc FROM orders WHERE id=NEW.order_id AND status='fulfilled';
 IF FOUND THEN SELECT total,basis INTO NEW.cost_total,NEW.cost_basis FROM order_line_cost(NEW.variant_id,NEW.reservation_id,loc,NEW.quantity);
 ELSE NEW.cost_total:=NULL;NEW.cost_basis:='unknown'; END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER order_item_cost BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION order_cost_on_insert();
--> statement-breakpoint
CREATE FUNCTION order_cost_on_fulfill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='fulfilled' AND OLD.status<>'fulfilled' THEN
   UPDATE order_items i SET cost_total=c.total,cost_basis=c.basis FROM
    (SELECT oi.id,x.* FROM order_items oi CROSS JOIN LATERAL order_line_cost(oi.variant_id,oi.reservation_id,NEW.location_id,oi.quantity) x WHERE oi.order_id=NEW.id) c WHERE i.id=c.id;
 END IF;
 RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER order_fulfillment_cost AFTER UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION order_cost_on_fulfill();
--> statement-breakpoint
CREATE TRIGGER receipts_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON stock_receipts FOR EACH STATEMENT EXECUTE FUNCTION inventory_immutable();
--> statement-breakpoint
CREATE TRIGGER receipt_lines_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON stock_receipt_lines FOR EACH STATEMENT EXECUTE FUNCTION inventory_immutable();
--> statement-breakpoint
CREATE TRIGGER valuations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON stock_valuations FOR EACH STATEMENT EXECUTE FUNCTION inventory_immutable();

--> statement-breakpoint
CREATE INDEX "receipt_line_variant_idx" ON "stock_receipt_lines" USING btree ("variant_id","receipt_id");--> statement-breakpoint
CREATE INDEX "receipts_supplier_date_idx" ON "stock_receipts" USING btree ("supplier_id","created_at");--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_stock_value_valid" CHECK ("inventory_balances"."stock_value" IS NULL OR "inventory_balances"."stock_value" BETWEEN 0 AND 9007199254740991);--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movement_cost_valid" CHECK ("inventory_movements"."cost_total" IS NULL OR "inventory_movements"."cost_total" BETWEEN 0 AND 9007199254740991);--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_line_cost_valid" CHECK (("order_items"."cost_total" IS NULL OR "order_items"."cost_total" BETWEEN 0 AND 9007199254740991) AND "order_items"."cost_basis" IN ('unknown','legacy','estimated','weighted_average'));--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD CONSTRAINT "receipt_reference_valid" CHECK (length("stock_receipts"."reference") <= 200);