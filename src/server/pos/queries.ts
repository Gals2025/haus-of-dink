import "server-only";
import { sql } from "drizzle-orm";
import type { AuthSession } from "../auth/authorize";
import { catalogActor } from "../catalog/queries";

export function posProductsQuery(identity: AuthSession) {
  return sql`with actor as materialized (${catalogActor(identity, "pos:sell")})
      select v.id, p.name, v.sku, v.barcode, v.price, br.id as "brandId", br.name as "brandName", c.id as "categoryId", c.name as "categoryName", v.inventory_mode as "inventoryMode",
        coalesce(jsonb_object_agg(l.id::text, case when not v.sales_enabled then 0 when v.inventory_mode='availability_only' then 10000 else coalesce(b.on_hand-b.reserved,0) end) filter (where l.id is not null), '{}'::jsonb) as stock
      from product_variants v join products p on p.id=v.product_id
      join brands br on br.id=p.brand_id join categories c on c.id=p.category_id
      left join inventory_locations l on true
      left join inventory_balances b on b.variant_id=v.id and b.location_id=l.id
      where exists(select 1 from actor) and p.status='active' and v.status='active' and v.currency='PHP'
      group by v.id,p.name,v.sku,v.barcode,v.price,br.id,c.id order by lower(p.name),lower(v.sku),v.id`;
}
