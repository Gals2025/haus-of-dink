import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getPermissionSession } from "@/server/auth/authorize";
import { getDb } from "@/server/db";
import { catalogActor } from "./queries";
import { errors, type Failure } from "./contracts";

type VariantRow = { id: string; productId: string; productName: string; sku: string; status: string; price: number; cost: number | null; currency: string; options: string | null };
export function createVariantReads(deps: {
  authorize: typeof getPermissionSession;
  read: <T extends Record<string, unknown>>(query: SQL) => Promise<T[]>;
}) {
return async function listVariants(input: unknown): Promise<{ ok: true; rows: VariantRow[]; total: number; page: number } | Failure> {
  try {
    const identity = await deps.authorize("inventory:read");
    if (!identity) return errors.FORBIDDEN;
    const parsed = z.strictObject({ search: z.string().trim().max(240).default(""), status: z.enum(["", "active", "inactive"]).default(""), page: z.coerce.number().int().min(1).max(1000000).default(1) }).safeParse(input);
    if (!parsed.success) return errors.VALIDATION;
    const { search, status, page } = parsed.data;
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const result = await deps.read<{ authorized: boolean; rows: VariantRow[]; total: number }>(sql`
      with actor as materialized (${catalogActor(identity, "inventory:read")}),
      filtered as materialized (select v.*, p.name as product_name from product_variants v join products p on p.id=v.product_id
        where exists(select 1 from actor) and (${search === ""} or v.sku ilike ${pattern} or p.name ilike ${pattern})
        and (${status === ""} or v.status::text=${status})),
      paged as (select v.id, v.product_id as "productId", v.product_name as "productName", v.sku, v.status, v.price, v.cost, v.currency,
        (select string_agg(a.name || ': ' || av.value, ' · ' order by a.name)
          from product_attribute_values pav join attribute_values av on av.id=pav.attribute_value_id join attributes a on a.id=av.attribute_id where pav.variant_id=v.id) as options
        from filtered v order by lower(v.product_name), lower(v.sku), v.id limit 20 offset ${(page - 1) * 20})
      select exists(select 1 from actor) as authorized, (select count(*)::int from filtered) as total,
        coalesce((select jsonb_agg(p) from paged p), '[]'::jsonb) as rows`);
    const row = result[0];
    return row?.authorized ? { ok: true, rows: row.rows, total: row.total, page } : errors.FORBIDDEN;
  } catch { return errors.UNAVAILABLE; }
}

}
export const listVariants = createVariantReads({
  authorize: getPermissionSession,
  read: async <T extends Record<string, unknown>>(query: SQL) => (await getDb().execute<T>(query)).rows,
});
