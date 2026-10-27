import "server-only";
import { z } from "zod";
import { sql, type SQL } from "drizzle-orm";
import { getPermissionSession } from "@/server/auth/authorize";
import { catalogActor } from "@/server/catalog/queries";
import { managementLock } from "@/server/admin/queries";
import { getDb } from "@/server/db";

const reorderInput = z.strictObject({ variantId: z.uuid(), locationId: z.uuid(), reorderLevel: z.number().int().min(0).max(1000000) });
export type ReorderResult = { ok: true } | { ok: false; error: string };
type Outcome = { authorized: boolean; found: boolean; logged: boolean };
export function createReorderSettings(deps: {
  authorize: typeof getPermissionSession;
  change: (query: SQL) => Promise<Outcome | undefined>;
}) {
  return async (input: unknown): Promise<ReorderResult> => {
    try {
      const identity = await deps.authorize("inventory:write");
      if (!identity) return { ok: false, error: "Access denied. Sign in with an authorized account." };
      const parsed = reorderInput.safeParse(input);
      if (!parsed.success) return { ok: false, error: "Choose a SKU and location, and a whole reorder level from 0 to 1,000,000." };
      const v = parsed.data;
      const result = await deps.change(sql`with actor as materialized (${catalogActor(identity, "inventory:write", true)}),
        target as materialized (select v.product_id, coalesce(b.reorder_level, 5) as before_level
          from product_variants v cross join inventory_locations l
          left join inventory_balances b on b.variant_id = v.id and b.location_id = l.id
          where v.id = ${v.variantId}::uuid and l.id = ${v.locationId}::uuid and exists(select 1 from actor)),
        changed as (insert into inventory_balances (variant_id, location_id, reorder_level)
          select ${v.variantId}::uuid, ${v.locationId}::uuid, ${v.reorderLevel} from target where before_level <> ${v.reorderLevel}
          on conflict (variant_id, location_id) do update set reorder_level = excluded.reorder_level, updated_at = clock_timestamp()
          returning variant_id),
        logged as (insert into catalog_audit (actor_id, product_id, action, changes)
          select a.id, t.product_id, 'update', jsonb_build_object('fields', jsonb_build_array('reorderLevel'),
            'variantId', c.variant_id, 'locationId', ${v.locationId}::uuid, 'before', t.before_level, 'after', ${v.reorderLevel}::integer)
          from changed c cross join target t cross join actor a returning id)
        select exists(select 1 from actor) as authorized, exists(select 1 from target) as found,
          exists(select 1 from logged) as logged`);
      if (!result?.authorized) return { ok: false, error: "Access denied. Your account or session may have changed." };
      if (!result.found) return { ok: false, error: "SKU or location unavailable. Refresh inventory." };
      return { ok: true };
    } catch { return { ok: false, error: "Unable to save the reorder level. Refresh and try again." }; }
  };
}
export const setReorderLevel = createReorderSettings({
  authorize: getPermissionSession,
  change: async (query) => {
    const db = getDb();
    const [, result] = await db.batch([db.execute(managementLock), db.execute<Outcome>(query)]);
    return result.rows[0];
  },
});
