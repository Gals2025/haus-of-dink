import "server-only";
import { sql } from "drizzle-orm";
import { currentPermissionSessionConditions, type AuthSession, type Permission } from "@/server/auth/authorize";
import { user, session } from "@/server/db/schema";
import type { ProductFilters } from "./contracts";

export function catalogActor(identity: AuthSession, permission: Permission, lock = false) {
  return sql`select ${user.id} from ${session} inner join ${user} on ${user.id} = ${session.userId}
    where ${currentPermissionSessionConditions(identity, permission, sql`clock_timestamp()`)}
    ${lock ? sql`for update of ${user}, ${session}` : sql``}`;
}
// These identifiers are fixed source code, never user input.
export const productJson = sql`jsonb_build_object('id', p.id, 'name', p.name, 'slug', p.slug,
  'description', p.description, 'shortDescription', p.short_description, 'brandId', p.brand_id,
  'categoryId', p.category_id, 'status', p.status, 'featured', p.featured, 'newArrival', p.new_arrival,
  'createdAt', p.created_at, 'updatedAt', p.updated_at)`;
export function listProductsQuery(identity: AuthSession, filters: ProductFilters) {
  const search = `%${filters.search.replace(/[\\%_]/g, "\\$&")}%`;
  const conditions = sql.join([
    sql`(${filters.search === ""} or p.name ilike ${search} or p.slug ilike ${search})`,
    ...(filters.status === undefined ? [] : [sql`p.status = ${filters.status}::product_status`]),
    ...(filters.brandId === undefined ? [] : [sql`p.brand_id = ${filters.brandId}::uuid`]),
    ...(filters.categoryId === undefined ? [] : [sql`p.category_id = ${filters.categoryId}::uuid`]),
    ...(filters.featured === undefined ? [] : [sql`p.featured = ${filters.featured}`]),
    ...(filters.newArrival === undefined ? [] : [sql`p.new_arrival = ${filters.newArrival}`]),
  ], sql` and `);
  const orders = { newest: sql`p.created_at desc, p.id`, oldest: sql`p.created_at, p.id`,
    name_asc: sql`lower(p.name), p.id`, name_desc: sql`lower(p.name) desc, p.id` };
  return sql`with actor as materialized (${catalogActor(identity, "inventory:read")}),
    filtered as materialized (select p.* from products p where exists(select 1 from actor) and ${conditions}),
    paged as (select ${productJson} as product from filtered p order by ${orders[filters.sort]}
      limit ${filters.pageSize} offset ${(filters.page - 1) * filters.pageSize})
    select exists(select 1 from actor) as authorized, (select count(*)::int from filtered) as total,
      coalesce((select jsonb_agg(product) from paged), '[]'::jsonb) as products`;
}
export function productDetailQuery(identity: AuthSession, id: string) {
  return sql`with actor as materialized (${catalogActor(identity, "inventory:read")})
    select exists(select 1 from actor) as authorized,
    (select ${productJson} || jsonb_build_object(
      'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'sku', v.sku,
        'barcode', v.barcode, 'price', v.price, 'compareAtPrice', v.compare_at_price,
        'currency', v.currency, 'status', v.status) order by lower(v.sku), v.id)
        from product_variants v where v.product_id = p.id), '[]'::jsonb),
      'images', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'variantId', i.variant_id,
        'blobUrl', i.blob_url, 'altText', i.alt_text, 'isPrimary', i.is_primary, 'sortOrder', i.sort_order)
        order by i.sort_order, i.id) from product_images i where i.product_id = p.id), '[]'::jsonb))
    from products p where p.id = ${id}::uuid and exists(select 1 from actor)) as product`;
}
