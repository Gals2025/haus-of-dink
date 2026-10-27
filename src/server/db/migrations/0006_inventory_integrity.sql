-- Incremental upgrade after the complete 0000–0005 chain. Existing rows
-- must satisfy all new checks; invalid history fails rather than being rewritten.
-- Unique targets must precede the composite foreign keys that reference them.
ALTER TABLE "inventory_movements" ADD COLUMN "source_location_id" uuid GENERATED ALWAYS AS (CASE WHEN after_on_hand < before_on_hand THEN location_id END) STORED;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "destination_location_id" uuid GENERATED ALWAYS AS (CASE WHEN after_on_hand > before_on_hand THEN location_id END) STORED;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "reversal_of_id" uuid;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_id_balance_unique" UNIQUE("id","variant_id","location_id");
--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_id_balance_unique" UNIQUE("id","variant_id","location_id");
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_source_location_id_inventory_locations_id_fk" FOREIGN KEY ("source_location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_destination_location_id_inventory_locations_id_fk" FOREIGN KEY ("destination_location_id") REFERENCES "public"."inventory_locations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movement_reservation_balance_fk" FOREIGN KEY ("reservation_id","variant_id","location_id") REFERENCES "public"."inventory_reservations"("id","variant_id","location_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movement_reversal_balance_fk" FOREIGN KEY ("reversal_of_id","variant_id","location_id") REFERENCES "public"."inventory_movements"("id","variant_id","location_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inventory_balances_location_idx" ON "inventory_balances" USING btree ("location_id","variant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_movements_one_reversal" ON "inventory_movements" USING btree ("reversal_of_id") WHERE "inventory_movements"."reversal_of_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "inventory_movements_actor_idx" ON "inventory_movements" USING btree ("actor_id");
--> statement-breakpoint
CREATE INDEX "inventory_movements_reservation_idx" ON "inventory_movements" USING btree ("reservation_id");
--> statement-breakpoint
CREATE INDEX "inventory_movements_source_idx" ON "inventory_movements" USING btree ("source_location_id");
--> statement-breakpoint
CREATE INDEX "inventory_movements_destination_idx" ON "inventory_movements" USING btree ("destination_location_id");
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movement_not_self_reversal" CHECK ("inventory_movements"."reversal_of_id" IS NULL OR "inventory_movements"."reversal_of_id" <> "inventory_movements"."id");
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movement_reservation_type" CHECK (("inventory_movements"."type" = 'RESERVATION' AND "inventory_movements"."reservation_id" IS NOT NULL) OR ("inventory_movements"."type" = 'RESERVATION_RELEASE' AND "inventory_movements"."reservation_id" IS NOT NULL) OR "inventory_movements"."type" = 'SALE' OR ("inventory_movements"."type" NOT IN ('RESERVATION', 'RESERVATION_RELEASE', 'SALE') AND "inventory_movements"."reservation_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movement_delta" CHECK (CASE
    WHEN "inventory_movements"."type" IN ('OPENING_STOCK', 'PURCHASE', 'RETURN', 'ADJUSTMENT_IN', 'CANCELLED_ORDER_RESTOCK') THEN "inventory_movements"."after_on_hand" - "inventory_movements"."before_on_hand" = "inventory_movements"."quantity" AND "inventory_movements"."after_reserved" = "inventory_movements"."before_reserved"
    WHEN "inventory_movements"."type" = 'RESERVATION' THEN "inventory_movements"."after_on_hand" = "inventory_movements"."before_on_hand" AND "inventory_movements"."after_reserved" - "inventory_movements"."before_reserved" = "inventory_movements"."quantity"
    WHEN "inventory_movements"."type" = 'RESERVATION_RELEASE' THEN "inventory_movements"."after_on_hand" = "inventory_movements"."before_on_hand" AND "inventory_movements"."before_reserved" - "inventory_movements"."after_reserved" = "inventory_movements"."quantity"
    WHEN "inventory_movements"."type" = 'SALE' AND "inventory_movements"."reservation_id" IS NOT NULL THEN "inventory_movements"."before_on_hand" - "inventory_movements"."after_on_hand" = "inventory_movements"."quantity" AND "inventory_movements"."before_reserved" - "inventory_movements"."after_reserved" = "inventory_movements"."quantity"
    ELSE "inventory_movements"."before_on_hand" - "inventory_movements"."after_on_hand" = "inventory_movements"."quantity" AND "inventory_movements"."after_reserved" = "inventory_movements"."before_reserved" END);
--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservation_reference" CHECK (length(trim("inventory_reservations"."reference")) > 0);
--> statement-breakpoint
-- References identify a full, exact compensating entry on the same balance.
-- The unique index serializes competing reversals of the same immutable row.
CREATE FUNCTION inventory_validate_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original inventory_movements%ROWTYPE;
BEGIN
 IF NEW.reversal_of_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO original FROM inventory_movements WHERE id = NEW.reversal_of_id;
 IF NOT FOUND OR original.reversal_of_id IS NOT NULL OR
    original.variant_id <> NEW.variant_id OR original.location_id <> NEW.location_id OR
    original.quantity <> NEW.quantity OR
    original.reservation_id IS DISTINCT FROM NEW.reservation_id OR
    original.after_on_hand - original.before_on_hand <> NEW.before_on_hand - NEW.after_on_hand OR
    original.after_reserved - original.before_reserved <> NEW.before_reserved - NEW.after_reserved
 THEN RAISE EXCEPTION 'Reversal must exactly compensate an original movement on the same balance'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER inventory_reversal_valid BEFORE INSERT ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION inventory_validate_reversal();
--> statement-breakpoint
-- Extend the atomic writer; the original nine-argument interface remains below.
CREATE FUNCTION inventory_apply(
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
   before_on_hand, after_on_hand, before_reserved, after_reserved, reservation_id, reason, reference, actor_id, reversal_of_id)
 VALUES(p_request, p_variant, p_location, p_type, p_quantity, b.on_hand, new_hand, b.reserved,
   new_reserved, reservation_id, p_reason, p_reference, p_actor, p_reversal) RETURNING id INTO movement_id;
 RETURN movement_id;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION inventory_apply(
 p_request uuid, p_variant uuid, p_location uuid, p_type inventory_movement_type,
 p_quantity integer, p_reason text, p_reference text, p_reservation uuid, p_actor text
) RETURNS uuid LANGUAGE sql VOLATILE AS $$
 SELECT inventory_apply(p_request, p_variant, p_location, p_type, p_quantity,
   p_reason, p_reference, p_reservation, p_actor, NULL::uuid);
$$;
