CREATE TABLE "catalog_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_audit_action_check" CHECK ("catalog_audit"."action" in ('create', 'update', 'archive', 'reactivate'))
);
--> statement-breakpoint
CREATE INDEX "catalog_audit_product_idx" ON "catalog_audit" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE FUNCTION reject_catalog_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Catalog audit history is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER catalog_audit_immutable BEFORE UPDATE OR DELETE ON catalog_audit
FOR EACH ROW EXECUTE FUNCTION reject_catalog_audit_change();
--> statement-breakpoint
CREATE TRIGGER catalog_audit_no_truncate BEFORE TRUNCATE ON catalog_audit
FOR EACH STATEMENT EXECUTE FUNCTION reject_catalog_audit_change();
