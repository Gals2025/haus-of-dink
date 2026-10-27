import "server-only";
import { sql } from "drizzle-orm";
import type { AuthSession, Permission } from "@/server/auth/authorize";
import { catalogActor } from "@/server/catalog/queries";
import type { CommerceInput, Filters } from "./contracts";
export type Area = "orders" | "customers" | "promotions" | "settings";
export function writePermission(input: CommerceInput): Permission {
  return input.action.startsWith("order.") ? "orders:write" : input.action === "customer.save" ? "customers:write" : input.action === "promotion.save" ? "promotions:write" : "settings:write";
}
export function commerceWrite(identity: AuthSession, requestId: string, input: CommerceInput) {
  return sql`with actor as materialized (${catalogActor(identity, writePermission(input), true)})
    select commerce_execute(actor.id,${requestId}::uuid,${JSON.stringify(input)}::jsonb) as id from actor`;
}
export function commerceList(identity: AuthSession, area: Area, filters: Filters) {
  const actor = catalogActor(identity, `${area}:read` as Permission);
  const search = `%${filters.search.replace(/[\\%_]/g,"\\$&")}%`;
  const select = area === "customers" ? sql`select id,name,email,phone,address,active from customers where (name ilike ${search} or email ilike ${search}) order by lower(name),id` :
    area === "promotions" ? sql`select id,code,kind,amount,minimum,starts_at as "startsAt",ends_at as "endsAt",usage_limit as "usageLimit",used,active from promotions where code ilike ${search} order by created_at desc,id` :
    area === "settings" ? sql`select name,email,phone,address,shipping_fee as "shippingFee" from store_settings where id=1` :
    sql`select o.id,o.customer_snapshot->>'name' as customer,o.status,o.payment_status as "paymentStatus",o.total,o.created_at as "createdAt" from orders o
      where (o.id::text ilike ${search} or o.customer_snapshot->>'name' ilike ${search}) and (${filters.status === "all"} or o.status=${filters.status}) order by o.created_at desc,o.id`;
  return sql`with actor as materialized (${actor}), rows as (${select})
    select exists(select 1 from actor) as authorized,
      coalesce((select jsonb_agg(r) from (select * from rows where exists(select 1 from actor) limit 26 offset ${(filters.page-1)*25}) r),'[]'::jsonb) as rows`;
}
export function orderDetailQuery(identity: AuthSession, id: string) {
  return sql`with actor as materialized (${catalogActor(identity,"orders:read")})
    select o.id,o.customer_snapshot->>'name' as customer,o.customer_snapshot as "customerSnapshot",o.status,o.payment_status as "paymentStatus",
      o.subtotal,o.discount,o.shipping_fee as "shippingFee",o.total,o.created_at::text as "createdAt",o.promotion_code as "promotionCode",o.payment_reference as "paymentReference",o.notes,l.name as location,
      (select jsonb_agg(jsonb_build_object('sku',i.sku,'name',i.name,'quantity',i.quantity,'unitPrice',i.unit_price) order by i.sku) from order_items i where i.order_id=o.id) as items,
      coalesce((select jsonb_agg(jsonb_build_object('action',a.action,'createdAt',a.created_at,'actor',coalesce(u.name,'Former account')) order by a.created_at,a.id)
        from commerce_audit a left join "user" u on u.id=a.actor_id where a.entity_id=o.id),'[]'::jsonb) as history
    from orders o join inventory_locations l on l.id=o.location_id where o.id=${id}::uuid and exists(select 1 from actor)`;
}
export function orderOptionsQuery(identity: AuthSession) {
  return sql`with actor as materialized (${catalogActor(identity,"orders:write")})
    select exists(select 1 from actor) as authorized,
    coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'email',c.email) order by c.name,c.id) from customers c where c.active and exists(select 1 from actor)),'[]'::jsonb) as customers,
    coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',l.name) order by l.name) from inventory_locations l where exists(select 1 from actor)),'[]'::jsonb) as locations,
    coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',p.name,'sku',v.sku,'price',v.price) order by p.name,v.sku) from product_variants v join products p on p.id=v.product_id where v.status='active' and p.status='active' and v.currency='PHP' and exists(select 1 from actor)),'[]'::jsonb) as variants`;
}
export function reportQuery(identity: AuthSession, start: string, end: string) {
  // Dates are Manila calendar days; half-open bounds include every fractional second.
  return sql`with actor as materialized (${catalogActor(identity,"reports:read")}), filtered as materialized (
    select o.* from orders o where exists(select 1 from actor) and o.created_at >= ${start}::date::timestamp at time zone 'Asia/Manila'
      and o.created_at < (${end}::date + 1)::timestamp at time zone 'Asia/Manila')
    select exists(select 1 from actor) as authorized,
    (select count(*)::int from filtered) as orders,
    (select count(*)::int from filtered where status='pending') as pending,
    (select count(*)::int from filtered where status='cancelled') as cancelled,
    coalesce((select sum(total) from filtered where status='fulfilled'),0)::text as revenue,
    coalesce((select sum(discount) from filtered where status='fulfilled'),0)::text as discounts,
    coalesce((select sum(shipping_fee) from filtered where status='fulfilled'),0)::text as shipping,
    coalesce((select sum(total) from filtered where payment_status='paid' and status='pending'),0)::text as deposits,
    coalesce((select sum(i.unit_cost::bigint*i.quantity) from order_items i join filtered o on o.id=i.order_id where o.status='fulfilled'),0)::text as cost,
    (select count(*)::int from order_items i join filtered o on o.id=i.order_id where o.status='fulfilled' and i.unit_cost is null) as "missingCost",
    coalesce((select jsonb_agg(d order by d.day) from (select (created_at at time zone 'Asia/Manila')::date::text as day,count(*)::int as orders,sum(total)::text as revenue from filtered where status='fulfilled' group by 1) d),'[]'::jsonb) as daily`;
}
