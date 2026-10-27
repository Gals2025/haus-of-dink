import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getPermissionSession } from "@/server/auth/authorize";
import { managementLock } from "@/server/admin/queries";
import { getDb } from "@/server/db";
import { variantCreate, errors, type Failure } from "./contracts";
import { catalogActor } from "./queries";

// Attribute assignment needs a separate workflow; reject it rather than silently ignoring it.
const inputSchema = variantCreate.safeExtend({ attributeValueIds: z.array(z.uuid()).max(0).default([]) });
export type VariantResult = { ok: true; productId: string; variantId: string } | Failure;
type Outcome = { authorized: boolean; found: boolean; eligible: boolean; variantId: string | null };
export function createVariantMutations(deps: {
  authorize: typeof getPermissionSession;
  change: (query: SQL) => Promise<Outcome | undefined>;
}) {
  return async function createVariant(input: unknown): Promise<VariantResult> {
    try {
      const identity = await deps.authorize("inventory:write");
      if (!identity) return errors.FORBIDDEN;
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) return { ...errors.VALIDATION, error: "Enter a SKU and valid prices. Compare-at price must be at least the selling price." };
      const v = parsed.data;
      const result = await deps.change(sql`with actor as materialized (${catalogActor(identity, "inventory:write", true)}),
        target as materialized (select p.id, p.status from products p where p.id = ${v.productId}::uuid
          and exists(select 1 from actor) for update of p),
        created as (insert into product_variants (product_id, sku, barcode, price, compare_at_price, cost, currency, status)
          select t.id, ${v.sku}, ${v.barcode}, ${v.price}, ${v.compareAtPrice}, ${v.cost}, ${v.currency}, ${v.status}::catalog_status
          from target t where t.status <> 'archived' returning id, product_id, sku, price, currency),
        logged as (insert into catalog_audit (actor_id, product_id, action, changes)
          select a.id, c.product_id, 'update', jsonb_build_object('fields', jsonb_build_array('variants'),
            'operation', 'variant_created', 'variantId', c.id, 'sku', c.sku, 'price', c.price, 'currency', c.currency)
          from created c cross join actor a returning product_id)
        select exists(select 1 from actor) as authorized, exists(select 1 from target) as found,
          exists(select 1 from target where status <> 'archived') as eligible,
          (select c.id from created c join logged l on l.product_id = c.product_id) as "variantId"`);
      if (!result?.authorized) return errors.FORBIDDEN;
      if (!result.found) return errors.NOT_FOUND;
      if (!result.eligible) return { ...errors.VALIDATION, error: "Reactivate the archived product before adding a SKU." };
      return result.variantId ? { ok: true, productId: v.productId, variantId: result.variantId } : errors.UNAVAILABLE;
    } catch (error) {
      let current = error;
      for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
        const e = current as { code?: string; constraint?: string; cause?: unknown };
        if (e.code === "23505" && ["product_variants_sku_ci_unique", "product_variants_barcode_unique"].includes(e.constraint ?? "")) {
          return { ...errors.CONFLICT, error: "That SKU or barcode is already in use." };
        }
        current = e.cause;
      }
      return errors.UNAVAILABLE;
    }
  };
}
export const createProductVariant = createVariantMutations({
  authorize: getPermissionSession,
  change: async (query) => {
    const db = getDb();
    const [, result] = await db.batch([db.execute(managementLock), db.execute<Outcome>(query)]);
    return result.rows[0];
  },
});
