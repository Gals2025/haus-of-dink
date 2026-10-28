ALTER TABLE "featured_items" DROP CONSTRAINT "featured_items_cta_not_blank";
--> statement-breakpoint
ALTER TABLE "featured_items" ADD CONSTRAINT "featured_items_cta_not_blank"
  CHECK ("cta_label" = '' OR length(trim("cta_label")) > 0);
--> statement-breakpoint
ALTER TABLE "featured_items" DROP CONSTRAINT "featured_items_internal_href";
--> statement-breakpoint
ALTER TABLE "featured_items" ADD CONSTRAINT "featured_items_internal_href"
  CHECK ("href" = '' OR ("href" like '/%' AND "href" not like '//%'));
