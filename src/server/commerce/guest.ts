import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import type { GuestInput, ShopCatalogItem } from "./guest-contracts";

// Explicit public projection: never expose costs, customer records or administrative data.
export const shopQuery = sql`select v.id,p.name,v.sku,v.price,
  br.name as brand,c.name as category,p.short_description as description,
  v.compare_at_price as "compareAtPrice",p.featured,p.new_arrival as "newArrival",
  image.blob_url as "imageUrl",image.alt_text as "imageAlt",
  least(10,coalesce(max(b.on_hand-b.reserved),0))::int as available
  from product_variants v join products p on p.id=v.product_id
  join brands br on br.id=p.brand_id
  join categories c on c.id=p.category_id
  left join lateral (
    select i.blob_url,i.alt_text from product_images i
    where i.product_id=p.id and (i.variant_id=v.id or i.variant_id is null)
    order by (i.variant_id=v.id) desc nulls last,i.is_primary desc,i.sort_order,i.id limit 1
  ) image on true
  left join inventory_balances b on b.variant_id=v.id
  where v.status='active' and p.status='active' and v.currency='PHP'
  group by v.id,p.id,br.name,c.name,image.blob_url,image.alt_text order by p.name,v.sku`;
export async function getShop() {
  const db = getDb();
  const [items, settings] = await Promise.all([
    db.execute<ShopCatalogItem>(shopQuery),
    db.execute<{ shipping: number }>(sql`select coalesce((select shipping_fee from store_settings where id=1),0) as shipping`),
  ]);
  return { items: items.rows, shipping: settings.rows[0]?.shipping ?? 0 };
}
export function guestWrite(request: string, input: GuestInput, rateKey: string) {
  // Persisted, atomic throttling works across server instances. Keys are server generated hashes.
  return sql`with throttle as (
    insert into rate_limit(id,key,count,last_request)
    values (${rateKey},${rateKey},1,(extract(epoch from clock_timestamp())*1000)::bigint)
    on conflict (key) do update set
      count=case when rate_limit.last_request < (extract(epoch from clock_timestamp())*1000)::bigint-600000 then 1 else rate_limit.count+1 end,
      last_request=case when rate_limit.last_request < (extract(epoch from clock_timestamp())*1000)::bigint-600000 then (extract(epoch from clock_timestamp())*1000)::bigint else rate_limit.last_request end
    returning count
  ), placed as materialized (
    select commerce_execute(null,${request}::uuid,${JSON.stringify(input)}::jsonb) as id from throttle where count<=10
  ) select id from placed`;
}
