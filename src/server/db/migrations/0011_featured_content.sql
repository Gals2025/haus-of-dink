CREATE TABLE "featured_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot" integer NOT NULL,
	"eyebrow" varchar(100) DEFAULT 'FEATURED' NOT NULL,
	"title" varchar(160) NOT NULL,
	"description" varchar(500) DEFAULT '' NOT NULL,
	"image_url" text,
	"image_alt" varchar(240) DEFAULT '' NOT NULL,
	"cta_label" varchar(80) DEFAULT 'Shop now' NOT NULL,
	"href" varchar(500) DEFAULT '/shop' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "featured_items_slot_unique" UNIQUE("slot"),
	CONSTRAINT "featured_items_slot_range" CHECK ("featured_items"."slot" between 1 and 3),
	CONSTRAINT "featured_items_title_not_blank" CHECK (length(trim("featured_items"."title")) > 0),
	CONSTRAINT "featured_items_cta_not_blank" CHECK (length(trim("featured_items"."cta_label")) > 0),
	CONSTRAINT "featured_items_internal_href" CHECK ("featured_items"."href" like '/%' and "featured_items"."href" not like '//%'),
	CONSTRAINT "featured_items_image_https" CHECK ("featured_items"."image_url" is null or "featured_items"."image_url" ~ '^https://[^/[:space:]]+/[^[:space:]]*$')
);
--> statement-breakpoint
INSERT INTO "featured_items" ("slot", "eyebrow", "title", "description", "image_alt", "cta_label", "href") VALUES
	(1, 'PLAY YOUR WAY', 'Find your paddle', 'Explore paddles made for your next great game.', 'A featured pickleball paddle', 'Shop paddles', '/shop'),
	(2, 'COURT ESSENTIALS', 'Game day ready', 'The little things that keep every rally rolling.', 'Pickleball court accessories', 'Shop accessories', '/shop'),
	(3, 'THE LATEST DROP', 'Fresh gear, fresh energy', 'Meet the newest additions to the Haus of Dink.', 'New Haus of Dink pickleball gear', 'Explore the shop', '/shop');
