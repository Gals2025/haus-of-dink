CREATE TABLE "admin_audit" (
  "id" text PRIMARY KEY NOT NULL,
  "actor_id" text NOT NULL,
  "target_id" text NOT NULL,
  "action" text NOT NULL CHECK ("action" IN ('role', 'status')),
  "before_role" text NOT NULL CHECK ("before_role" IN ('staff', 'admin', 'super_admin')),
  "after_role" text NOT NULL CHECK ("after_role" IN ('staff', 'admin', 'super_admin')),
  "before_active" boolean NOT NULL,
  "after_active" boolean NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin_audit" ("created_at");
--> statement-breakpoint
CREATE INDEX "admin_audit_target_idx" ON "admin_audit" ("target_id");
--> statement-breakpoint
CREATE FUNCTION reject_admin_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Administrative audit history is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER admin_audit_immutable BEFORE UPDATE OR DELETE ON "admin_audit"
FOR EACH ROW EXECUTE FUNCTION reject_admin_audit_change();
--> statement-breakpoint
CREATE TRIGGER admin_audit_no_truncate BEFORE TRUNCATE ON "admin_audit"
FOR EACH STATEMENT EXECUTE FUNCTION reject_admin_audit_change();
--> statement-breakpoint
-- Hold a shared user-row lock until session creation commits. Deactivation's
-- target-row lock then orders session insertion before revocation, or rejects it
-- after deactivation. An inactive user cannot accumulate sessions for reactivation.
CREATE FUNCTION require_active_session_user() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE enabled boolean;
BEGIN
  SELECT active INTO enabled FROM "user" WHERE id = NEW.user_id FOR SHARE;
  IF enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'An active account is required to create a session';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER session_active_user BEFORE INSERT ON "session"
FOR EACH ROW EXECUTE FUNCTION require_active_session_user();
