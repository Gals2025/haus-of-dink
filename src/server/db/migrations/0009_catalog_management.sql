CREATE TABLE "catalog_management_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_management_audit_type_check" CHECK ("catalog_management_audit"."entity_type" in ('brand', 'category', 'attribute', 'value')),
	CONSTRAINT "catalog_management_audit_action_check" CHECK ("catalog_management_audit"."action" in ('create', 'update', 'delete'))
);
--> statement-breakpoint
CREATE INDEX "catalog_management_audit_entity_idx" ON "catalog_management_audit" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE TRIGGER catalog_management_audit_immutable BEFORE UPDATE OR DELETE ON catalog_management_audit
FOR EACH ROW EXECUTE FUNCTION reject_catalog_audit_change();
--> statement-breakpoint
CREATE TRIGGER catalog_management_audit_no_truncate BEFORE TRUNCATE ON catalog_management_audit
FOR EACH STATEMENT EXECUTE FUNCTION reject_catalog_audit_change();
