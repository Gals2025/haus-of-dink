CREATE TYPE inventory_movement_type AS ENUM ('OPENING_STOCK', 'PURCHASE', 'SALE', 'RESERVATION', 'RESERVATION_RELEASE', 'RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGED', 'LOST', 'CANCELLED_ORDER_RESTOCK');
--> statement-breakpoint
CREATE TABLE inventory_locations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(160) NOT NULL UNIQUE,
 CONSTRAINT inventory_location_name CHECK (length(trim(name)) > 0)
);
--> statement-breakpoint
INSERT INTO inventory_locations(id, name) VALUES ('00000000-0000-4000-8000-000000000001', 'Main stockroom');
--> statement-breakpoint
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
