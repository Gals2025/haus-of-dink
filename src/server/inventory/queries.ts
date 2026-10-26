import "server-only";
import { sql } from "drizzle-orm";
import { currentPermissionSessionConditions, type AuthSession, type Permission } from "@/server/auth/authorize";
import { user, session } from "@/server/db/schema";
import { pageSize, type StockChange, type StockFilters } from "./contracts";

export function inventoryPermission(type: StockChange["type"]): Permission {
  return type === "SALE" ? "inventory:sell" : ["RESERVATION", "RESERVATION_RELEASE"].includes(type) ? "inventory:reserve" : "inventory:write";
}
function actor(identity: AuthSession, permission: Permission, lock = false) {
  return sql`select ${user.id} from ${session} inner join ${user} on ${user.id} = ${session.userId}
    where ${currentPermissionSessionConditions(identity, permission, sql`clock_timestamp()`)} ${lock ? sql`for update of ${user}, ${session}` : sql``}`;
}
export function applyStockQuery(identity: AuthSession, change: StockChange) {
  return sql`with actor as materialized (${actor(identity, inventoryPermission(change.type), true)})
    select inventory_apply(${change.requestId}::uuid, ${change.variantId}::uuid, ${change.locationId}::uuid,
      ${change.type}::inventory_movement_type, ${change.quantity}::integer, ${change.reason}, ${change.reference},
      ${change.reservationId}::uuid, actor.id) as id from actor`;
}
export function stockQuery(identity: AuthSession, filters: StockFilters) {
  const search = `%${filters.search.replace(/[\\%_]/g, "\\$&")}%`;
  return sql`select v.id as "variantId", v.sku, p.name,
    coalesce(b.on_hand, 0)::int as "onHand", coalesce(b.reserved, 0)::int as reserved,
    (coalesce(b.on_hand, 0) - coalesce(b.reserved, 0))::int as available,
    coalesce(b.reorder_level, 5)::int as "reorderLevel"
    from product_variants v join products p on p.id = v.product_id
    left join inventory_balances b on b.variant_id = v.id and b.location_id = ${filters.locationId}::uuid
    where exists (${actor(identity, "inventory:read")})
    and (${filters.search === ""} or v.sku ilike ${search} or p.name ilike ${search})
    and (${filters.status === "all"} or
      (${filters.status === "out"} and coalesce(b.on_hand, 0) - coalesce(b.reserved, 0) = 0) or
      (${filters.status === "low"} and coalesce(b.on_hand, 0) - coalesce(b.reserved, 0) <= coalesce(b.reorder_level, 5)))
    order by lower(p.name), lower(v.sku), v.id limit ${pageSize + 1} offset ${(filters.page - 1) * pageSize}`;
}
export function locationsQuery(identity: AuthSession) {
  return sql`select id, name from inventory_locations where exists (${actor(identity, "inventory:read")}) order by name`;
}
export function movementsQuery(identity: AuthSession, filters: StockFilters) {
  const search = `%${filters.search.replace(/[\\%_]/g, "\\$&")}%`;
  return sql`select m.id, v.sku, l.name as location, m.type, m.quantity,
    m.before_on_hand as "beforeOnHand", m.after_on_hand as "afterOnHand", m.before_reserved as "beforeReserved",
    m.after_reserved as "afterReserved", m.reason, m.reference, u.name as actor, m.created_at::text as "createdAt"
    from inventory_movements m join product_variants v on v.id = m.variant_id
    join inventory_locations l on l.id = m.location_id join "user" u on u.id = m.actor_id
    where m.location_id = ${filters.locationId}::uuid and exists (${actor(identity, "inventory:read")})
    and (${filters.search === ""} or v.sku ilike ${search} or m.reference ilike ${search})
    order by m.created_at desc, m.id desc limit ${pageSize + 1} offset ${(filters.page - 1) * pageSize}`;
}
