import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getPermissionSession } from "@/server/auth/authorize";
import { managementLock } from "@/server/admin/queries";
import { getDb } from "@/server/db";
import { variantCreate, errors, type Failure } from "./contracts";
import { catalogActor } from "./queries";
import { catalogFailure } from "./management";

export type VariantResult = { ok: true; productId: string; variantId: string } | Failure;
type Outcome = { authorized: boolean; found: boolean; eligible: boolean; variantId: string | null; validAttributes?: boolean; duplicate?: boolean };
export function createVariantMutations(deps: {
  authorize: typeof getPermissionSession;
  change: (query: SQL) => Promise<Outcome | undefined>;
}) {
  // Full-state edit is validated against the same rules as creation, including cross-field prices.
  return async function mutateVariant(input: unknown, variantId?: unknown, remove = false): Promise<VariantResult> {
    try {
      const identity = await deps.authorize("inventory:write");
      if (!identity) return errors.FORBIDDEN;
      const parsed = remove ? z.strictObject({ productId: z.uuid() }).safeParse(input) : variantCreate.safeParse(input);
      const parsedId = z.uuid().optional().safeParse(variantId);
      if (!parsed.success || !parsedId.success || (remove && !parsedId.data)) return { ...errors.VALIDATION, error: "Enter a SKU and valid prices. Compare-at price must be at least the selling price. Select one value per attribute." };
      const productId = parsed.data.productId;
      const id = parsedId.data ?? crypto.randomUUID();
      const v = !remove ? variantCreate.parse(parsed.data) : null;
      const valueIds = v?.attributeValueIds ?? [];
      const ids = sql`${JSON.stringify(valueIds)}::jsonb`;
      const eligible = remove ? sql`not exists(select 1 from inventory_movements where variant_id=${id}::uuid)
        and not exists(select 1 from inventory_reservations where variant_id=${id}::uuid)
        and not exists(select 1 from inventory_balances where variant_id=${id}::uuid and (on_hand<>0 or reserved<>0))` : sql`true`;
      const writeValues = v ? sql`${v.sku}, ${v.barcode}, ${v.price}, ${v.compareAtPrice}, ${v.cost}, ${v.currency}, ${v.status}::catalog_status` : sql``;
      const changed = remove ? sql`delete from product_variants v using existing e where v.id=e.id and (select eligible from checks)
        and (select count(*) from removed_balances)>=0 returning v.*` : parsedId.data ?
        sql`update product_variants v set (sku, barcode, price, compare_at_price, cost, currency, status)=(${writeValues}), updated_at=clock_timestamp()
          from existing e where v.id=e.id and (select eligible and "validAttributes" and not duplicate from checks) returning v.*` :
        sql`insert into product_variants(id, product_id, sku, barcode, price, compare_at_price, cost, currency, status)
          select ${id}::uuid, t.id, ${writeValues} from target t where (select eligible and "validAttributes" and not duplicate from checks) returning *`;
      const result = await deps.change(sql`with actor as materialized (${catalogActor(identity, "inventory:write", true)}),
        target as materialized (select p.id, p.status from products p where p.id=${productId}::uuid and exists(select 1 from actor) for update),
        existing as materialized (select v.* from product_variants v join target t on v.product_id=t.id where v.id=${id}::uuid for update of v),
        selected_values as materialized (select av.id, av.attribute_id from attribute_values av where av.id in (select jsonb_array_elements_text(${ids})::uuid)),
        checks as materialized (select exists(select 1 from target where status<>'archived') and ${eligible} as eligible,
          (select count(*)=${valueIds.length} and count(distinct attribute_id)=${valueIds.length} from selected_values) as "validAttributes",
          ${valueIds.length > 0 ? sql`exists(select 1 from product_variants other join target t on t.id=other.product_id
            where other.id<>${id}::uuid and
              (select coalesce(jsonb_agg(pav.attribute_value_id::text order by pav.attribute_value_id::text), '[]'::jsonb)
                from product_attribute_values pav where pav.variant_id=other.id) =
              (select coalesce(jsonb_agg(s.id::text order by s.id::text), '[]'::jsonb) from selected_values s))` : sql`false`} as duplicate),
        removed_balances as (delete from inventory_balances b where ${remove} and b.variant_id in (select id from existing)
          and (select eligible from checks) returning b.variant_id),
        changed as (${changed}),
        removed_attributes as (delete from product_attribute_values pav where ${!remove} and pav.variant_id in (select id from changed)
          and pav.attribute_value_id not in (select id from selected_values) returning id),
        assigned as (insert into product_attribute_values(product_id, variant_id, attribute_id, attribute_value_id)
          select c.product_id, c.id, s.attribute_id, s.id from changed c cross join selected_values s where ${!remove}
            and (select count(*) from removed_attributes)>=0
          on conflict (variant_id, attribute_id) where variant_id is not null do update set attribute_value_id=excluded.attribute_value_id, updated_at=clock_timestamp()
          returning id),
        logged as (insert into catalog_audit(actor_id, product_id, action, changes)
          select a.id, c.product_id, 'update', jsonb_build_object('fields', jsonb_build_array('variants'),
            'operation', ${remove ? "variant_deleted" : parsedId.data ? "variant_updated" : "variant_created"}::text, 'variantId', c.id,
            'sku', c.sku, 'price', c.price, 'currency', c.currency,
            'before', (select to_jsonb(e) from existing e), 'after', ${remove ? sql`null::jsonb` : sql`to_jsonb(c)`},
            'attributeValueIds', ${ids}, 'beforeAttributeValueIds',
              (select coalesce(jsonb_agg(pav.attribute_value_id order by pav.attribute_value_id), '[]'::jsonb)
                from product_attribute_values pav where pav.variant_id in (select id from existing)))
          from changed c cross join actor a where (select count(*) from assigned)>=0 returning product_id)
        select exists(select 1 from actor) as authorized,
          (exists(select 1 from target) and (${parsedId.data === undefined} or exists(select 1 from existing))) as found,
          (select eligible from checks) as eligible, (select "validAttributes" from checks) as "validAttributes", (select duplicate from checks) as duplicate,
          (select c.id from changed c join logged l on l.product_id=c.product_id) as "variantId"`);
      if (!result?.authorized) return errors.FORBIDDEN;
      if (!result.found) return errors.NOT_FOUND;
      if (!result.eligible) return { ...errors.VALIDATION, error: remove ? "This SKU has stock or inventory history. Deactivate it instead. Archived products must first be reactivated." : "Reactivate the archived product before changing a SKU." };
      if (result.validAttributes === false) return { ...errors.VALIDATION, error: "Select existing values, with only one value per attribute." };
      if (result.duplicate) return { ...errors.CONFLICT, error: "A variant with this attribute combination already exists for this product." };
      return result.variantId ? { ok: true, productId, variantId: result.variantId } : errors.UNAVAILABLE;
    } catch (error) { return catalogFailure(error); }
  };
}
const mutateVariant = createVariantMutations({
  authorize: getPermissionSession,
  change: async (query) => {
    const db = getDb();
    const [, result] = await db.batch([db.execute(managementLock), db.execute<Outcome>(query)]);
    return result.rows[0];
  },
});
export const createProductVariant = (input: unknown) => mutateVariant(input);
export const updateProductVariant = (id: unknown, input: unknown) => mutateVariant(input, id);
export const deleteProductVariant = (id: unknown, productId: unknown) => mutateVariant({ productId }, id, true);
