CREATE TABLE "user" ("id" text PRIMARY KEY NOT NULL, "name" text NOT NULL, "email" text NOT NULL UNIQUE, "email_verified" boolean DEFAULT false NOT NULL, "image" text, "role" text DEFAULT 'staff' NOT NULL, "active" boolean DEFAULT false NOT NULL, "created_at" timestamptz DEFAULT now() NOT NULL, "updated_at" timestamptz DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE TABLE "session" ("id" text PRIMARY KEY NOT NULL, "expires_at" timestamptz NOT NULL, "token" text NOT NULL UNIQUE, "created_at" timestamptz DEFAULT now() NOT NULL, "updated_at" timestamptz DEFAULT now() NOT NULL, "ip_address" text, "user_agent" text, "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE);
--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" ("user_id");
--> statement-breakpoint
CREATE TABLE "account" ("id" text PRIMARY KEY NOT NULL, "account_id" text NOT NULL, "provider_id" text NOT NULL, "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, "access_token" text, "refresh_token" text, "id_token" text, "access_token_expires_at" timestamptz, "refresh_token_expires_at" timestamptz, "scope" text, "password" text, "created_at" timestamptz DEFAULT now() NOT NULL, "updated_at" timestamptz DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" ("user_id");
--> statement-breakpoint
CREATE TABLE "verification" ("id" text PRIMARY KEY NOT NULL, "identifier" text NOT NULL, "value" text NOT NULL, "expires_at" timestamptz NOT NULL, "created_at" timestamptz DEFAULT now() NOT NULL, "updated_at" timestamptz DEFAULT now() NOT NULL);
--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_staff_role_check" CHECK ("role" IN ('staff','admin','super_admin'));
--> statement-breakpoint
CREATE TABLE "rate_limit" ("id" text PRIMARY KEY NOT NULL, "key" text NOT NULL UNIQUE, "count" integer NOT NULL, "last_request" timestamptz NOT NULL);
