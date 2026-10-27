-- Extend the append-only access history to cover the account lifecycle.
ALTER TABLE admin_audit DROP CONSTRAINT admin_audit_action_check;
--> statement-breakpoint
ALTER TABLE admin_audit ADD CONSTRAINT admin_audit_action_check
  CHECK (action IN ('role', 'status', 'create', 'profile', 'delete'));
