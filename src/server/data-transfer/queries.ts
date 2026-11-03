import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { currentPermissionSessionConditions, type AuthSession } from "../auth/authorize";
import { session, user } from "../db/schema/auth";

export function transferExportQuery(kind: "products" | "inventory", identity: AuthSession): SQL {
  let query: SQL;
  if (kind === "products") query = sql`select p.slug as product_slug, p.name as product_name, p.description, p.short_description, b.name as brand, c.name as category, p.status as product_status, p.featured, p.new_arrival, v.sku, v.barcode, v.price as price_cents, v.compare_at_price as compare_at_price_cents, v.cost as cost_cents, v.currency, v.status as variant_status, v.inventory_mode, case when v.sales_enabled then 'available' else 'unavailable' end as availability
    from products p join brands b on b.id=p.brand_id join categories c on c.id=p.category_id join product_variants v on v.product_id=p.id
    where exists(select 1 from ${session} inner join ${user} on ${user.id} = ${session.userId} where ${currentPermissionSessionConditions(identity, "inventory:read", sql`clock_timestamp()`)}) order by p.name, v.sku`;
  else query = sql`select v.sku, l.id as location_id, case when v.inventory_mode='counted' then coalesce(b.on_hand,0)::text else '' end as target_on_hand, '' as reason, '' as reference, v.inventory_mode, case when v.sales_enabled then 'available' else 'unavailable' end as availability
    from product_variants v cross join inventory_locations l left join inventory_balances b on b.variant_id=v.id and b.location_id=l.id
    where exists(select 1 from ${session} inner join ${user} on ${user.id} = ${session.userId} where ${currentPermissionSessionConditions(identity, "inventory:read", sql`clock_timestamp()`)}) order by l.name, v.sku`;
  return query;
}
