-- Database-managed timestamps also cover writes made outside Drizzle.
CREATE FUNCTION public.catalog_set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER brands_updated_at BEFORE UPDATE ON public.brands
FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER categories_updated_at BEFORE UPDATE ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER product_variants_updated_at BEFORE UPDATE ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER product_images_updated_at BEFORE UPDATE ON public.product_images
FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER attributes_updated_at BEFORE UPDATE ON public.attributes
FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER attribute_values_updated_at BEFORE UPDATE ON public.attribute_values
FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER product_attribute_values_updated_at BEFORE UPDATE ON public.product_attribute_values
FOR EACH ROW EXECUTE FUNCTION public.catalog_set_updated_at();
--> statement-breakpoint
-- Serialize hierarchy writes, then reject indirect cycles as well as self-parenting.
-- Application hierarchy writes should use READ COMMITTED (PostgreSQL default).
CREATE FUNCTION public.catalog_check_category_cycle() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(729142001);
  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM public.categories WHERE id = NEW.parent_id
      UNION
      SELECT c.id, c.parent_id FROM public.categories c
      JOIN ancestors a ON c.id = a.parent_id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Category hierarchy cannot contain a cycle'
      USING ERRCODE = '23514', CONSTRAINT = 'categories_no_cycles';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER categories_no_cycles
AFTER INSERT OR UPDATE ON public.categories
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION public.catalog_check_category_cycle();
