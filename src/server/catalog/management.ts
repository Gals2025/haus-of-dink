import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getPermissionSession } from "@/server/auth/authorize";
import { managementLock } from "@/server/admin/queries";
import { getDb } from "@/server/db";
import { catalogActor } from "./queries";
import { errors, type Failure } from "./contracts";
import { entityInputs, entityKind, type EntityKind, type ManagementData } from "./management-contracts";

const tables = { brand: "brands", category: "categories", attribute: "attributes", value: "attribute_values" } as const;
const columns: Record<string, string> = { name: "name", slug: "slug", description: "description", status: "status", websiteUrl: "website_url", logoUrl: "logo_url", parentId: "parent_id", unit: "unit", attributeId: "attribute_id", value: "value", sortOrder: "sort_order" };
type Outcome = { authorized: boolean; found: boolean; eligible: boolean; changed: boolean };
export type ManagementResult = { ok: true; id: string } | Failure;
export type ManagementDeps = {
  authorize: typeof getPermissionSession;
  read: <T extends Record<string, unknown>>(query: SQL) => Promise<T[]>;
  change: (query: SQL) => Promise<Outcome | undefined>;
};
export function catalogFailure(error: unknown): Failure {
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    const e = current as { code?: string; cause?: unknown };
    if (e.code === "23505") return { ...errors.CONFLICT, error: "That name, slug, SKU, barcode or variant combination is already in use." };
    if (e.code === "23503") return { ...errors.REFERENCE, error: "This record is in use or a selected reference is unavailable. Refresh and try again." };
    if (e.code === "23514") return { ...errors.VALIDATION, error: "Check the values and selected references." };
    current = e.cause;
  }
  return errors.UNAVAILABLE;
}
export function createCatalogManagement(deps: ManagementDeps) {
  return {
    async list(): Promise<({ ok: true } & ManagementData) | Failure> {
      try {
        const identity = await deps.authorize("inventory:read");
        if (!identity) return errors.FORBIDDEN;
        const [row] = await deps.read<ManagementData & { authorized: boolean }>(sql`
          with actor as materialized (${catalogActor(identity, "inventory:read")})
          select exists(select 1 from actor) as authorized,
          coalesce((select jsonb_agg(to_jsonb(b) || jsonb_build_object('websiteUrl', b.website_url, 'logoUrl', b.logo_url,
            'usage', (select count(*) from products p where p.brand_id=b.id)) order by lower(b.name), b.id)
            from brands b where exists(select 1 from actor)), '[]'::jsonb) as brands,
          coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('parentId', c.parent_id,
            'usage', (select count(*) from products p where p.category_id=c.id) + (select count(*) from categories child where child.parent_id=c.id)) order by lower(c.name), c.id)
            from categories c where exists(select 1 from actor)), '[]'::jsonb) as categories,
          coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object('usage', (select count(*) from attribute_values v where v.attribute_id=a.id)) order by lower(a.name), a.id)
            from attributes a where exists(select 1 from actor)), '[]'::jsonb) as attributes,
          coalesce((select jsonb_agg(to_jsonb(v) || jsonb_build_object('name', v.value, 'attributeId', v.attribute_id, 'sortOrder', v.sort_order,
            'usage', (select count(*) from product_attribute_values av where av.attribute_value_id=v.id)) order by v.sort_order, lower(v.value), v.id)
            from attribute_values v where exists(select 1 from actor)), '[]'::jsonb) as values`);
        if (!row?.authorized) return errors.FORBIDDEN;
        return { ok: true, brands: row.brands, categories: row.categories, attributes: row.attributes, values: row.values };
      } catch { return errors.UNAVAILABLE; }
    },
    async history(): Promise<{ ok: true; entries: { id: string; entityType: string; entityId: string; action: string; createdAt: string; changes: Record<string, unknown> }[] } | Failure> {
      try {
        const identity = await deps.authorize("inventory:read");
        if (!identity) return errors.FORBIDDEN;
        const [row] = await deps.read<{ authorized: boolean; entries: { id: string; entityType: string; entityId: string; action: string; createdAt: string; changes: Record<string, unknown> }[] }>(sql`
          with actor as materialized (${catalogActor(identity, "inventory:read")})
          select exists(select 1 from actor) as authorized,
          coalesce((select jsonb_agg(e) from (select id, entity_type as "entityType", entity_id as "entityId", action, changes, created_at as "createdAt"
            from catalog_management_audit where exists(select 1 from actor) order by created_at desc, id desc limit 100) e), '[]'::jsonb) as entries`);
        return row?.authorized ? { ok: true, entries: row.entries } : errors.FORBIDDEN;
      } catch { return errors.UNAVAILABLE; }
    },
    async save(kind: unknown, id: unknown, input: unknown): Promise<ManagementResult> {
      return mutate(kind, id, input, false);
    },
    async remove(kind: unknown, id: unknown): Promise<ManagementResult> {
      return mutate(kind, id, {}, true);
    },
  };
  async function mutate(kindInput: unknown, idInput: unknown, input: unknown, remove: boolean): Promise<ManagementResult> {
    try {
      const identity = await deps.authorize("inventory:write");
      if (!identity) return errors.FORBIDDEN;
      const kindParsed = entityKind.safeParse(kindInput);
      const idParsed = z.uuid().nullable().safeParse(idInput);
      if (!kindParsed.success || !idParsed.success || (remove && !idParsed.data)) return errors.VALIDATION;
      const kind: EntityKind = kindParsed.data;
      const parsed = entityInputs[kind].safeParse(input);
      if (!remove && !parsed.success) return { ...errors.VALIDATION, error: "Check the required fields, slug and HTTPS URLs." };
      const id = idParsed.data ?? crypto.randomUUID();
      const creating = idParsed.data === null;
      const values = !remove && parsed.success ? parsed.data : {};
      const entries = Object.entries(values);
      const table = sql.identifier(tables[kind]);
      // References and recursive ancestry are checked under the shared management lock.
      const parent = "parentId" in values ? values.parentId : null;
      const validParent = kind === "category" && parent ? sql`exists(select 1 from categories where id=${parent}::uuid)
        and not exists(with recursive ancestors as (
          select id, parent_id from categories where id=${parent}::uuid
          union select c.id, c.parent_id from categories c join ancestors a on c.id=a.parent_id
        ) select 1 from ancestors where id=${id}::uuid)` : sql`true`;
      const eligible = remove ? (
        kind === "brand" ? sql`not exists(select 1 from products where brand_id=${id}::uuid)` :
        kind === "category" ? sql`not exists(select 1 from products where category_id=${id}::uuid) and not exists(select 1 from categories where parent_id=${id}::uuid)` :
        kind === "attribute" ? sql`not exists(select 1 from attribute_values where attribute_id=${id}::uuid)` :
        sql`not exists(select 1 from product_attribute_values where attribute_value_id=${id}::uuid)`
      ) : sql`${validParent} ${kind === "value" && "attributeId" in values ? sql`and exists(select 1 from attributes where id=${values.attributeId}::uuid)
        and not exists(select 1 from target where attribute_id <> ${values.attributeId}::uuid)` : sql``}`;
      const changed = remove ? sql`delete from ${table} t using target old where t.id=old.id and (select eligible from checks) returning t.*` :
        creating ? sql`insert into ${table} (id, ${sql.join(entries.map(([key]) => sql.identifier(columns[key]!)), sql`, `)})
          select ${id}::uuid, ${sql.join(entries.map(([, value]) => sql`${value}`), sql`, `)} from actor where (select eligible from checks) returning *` :
        sql`update ${table} t set ${sql.join(entries.map(([key, value]) => sql`${sql.identifier(columns[key]!)}=${value}`), sql`, `)}, updated_at=clock_timestamp()
          from target old where t.id=old.id and (select eligible from checks) returning t.*`;
      const result = await deps.change(sql`with actor as materialized (${catalogActor(identity, "inventory:write", true)}),
        target as materialized (select * from ${table} where id=${id}::uuid and exists(select 1 from actor) for update),
        checks as materialized (select ${eligible} as eligible),
        changed as (${changed}),
        logged as (insert into catalog_management_audit(actor_id, entity_type, entity_id, action, changes)
          select a.id, ${kind}, c.id, ${remove ? "delete" : creating ? "create" : "update"},
            jsonb_build_object('name', ${kind === "value" ? sql`c.value` : sql`c.name`},
              'before', (select to_jsonb(t) - 'description' from target t),
              'after', ${remove ? sql`null::jsonb` : sql`to_jsonb(c) - 'description'`})
          from changed c cross join actor a returning id)
        select exists(select 1 from actor) as authorized, exists(select 1 from target) as found,
          (select eligible from checks) as eligible, exists(select 1 from logged) as changed`);
      if (!result?.authorized) return errors.FORBIDDEN;
      if (!creating && !result.found) return { ...errors.NOT_FOUND, error: "Record no longer exists." };
      if (!result.eligible) return { ...errors.REFERENCE, error: remove ? "This record is in use. Remove its references first, or deactivate it." : "Invalid parent or attribute. Categories cannot contain ancestry cycles, and values cannot change their owning attribute." };
      return result.changed ? { ok: true, id } : errors.UNAVAILABLE;
    } catch (error) { return catalogFailure(error); }
  }
}
export const catalogManagement = createCatalogManagement({
  authorize: getPermissionSession,
  read: async <T extends Record<string, unknown>>(query: SQL) => (await getDb().execute<T>(query)).rows,
  change: async (query) => {
    const db = getDb();
    const [, result] = await db.batch([db.execute(managementLock), db.execute<Outcome>(query)]);
    return result.rows[0];
  },
});
