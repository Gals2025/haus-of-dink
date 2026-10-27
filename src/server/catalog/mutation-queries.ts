import "server-only";
import { sql } from "drizzle-orm";
import type { AuthSession } from "@/server/auth/authorize";
import type { ProductInput, ProductPatch } from "./contracts";
import { catalogActor } from "./queries";

export type ProductAction = "create" | "update" | "archive" | "reactivate";
const columns = {
  name: "name", slug: "slug", description: "description", shortDescription: "short_description",
  brandId: "brand_id", categoryId: "category_id", status: "status", featured: "featured", newArrival: "new_arrival",
} as const;
// Audit only approved catalog fields. Descriptions are represented by length,
// never free-text content. Session tokens and account data cannot enter this DTO.
const safeState = sql`jsonb_build_object('name', p.name, 'slug', p.slug, 'brandId', p.brand_id,
  'categoryId', p.category_id, 'status', p.status, 'featured', p.featured, 'newArrival', p.new_arrival,
  'descriptionLength', length(p.description), 'shortDescriptionLength', length(p.short_description))`;
export function mutateProductQuery(identity: AuthSession, action: ProductAction, id: string, input: ProductInput | ProductPatch = {}) {
  const entries = Object.entries(input) as [keyof typeof columns, unknown][];
  const references = sql.join([
    input.brandId === undefined ? sql`true` : sql`exists(select 1 from brands where id=${input.brandId}::uuid and (status='active' or exists(select 1 from target where brand_id=${input.brandId}::uuid)))`,
    input.categoryId === undefined ? sql`true` : sql`exists(select 1 from categories where id=${input.categoryId}::uuid and (status='active' or exists(select 1 from target where category_id=${input.categoryId}::uuid)))`,
  ], sql` and `);
  const changed = action === "create"
    ? sql`insert into products (id, name, slug, description, short_description, brand_id, category_id, status, featured, new_arrival)
        select ${id}::uuid, ${input.name}, ${input.slug}, ${input.description ?? null}, ${input.shortDescription ?? null},
          ${input.brandId}::uuid, ${input.categoryId}::uuid, ${input.status}::product_status, ${input.featured}, ${input.newArrival}
        from actor where (select valid from refs) returning *`
    : sql`update products p set ${action === "update"
      ? (entries.length ? sql.join(entries.map(([key, value]) => sql`${sql.identifier(columns[key])} = ${value}`), sql`, `) : sql`name = p.name`)
      : sql`status = ${action === "archive" ? "archived" : "draft"}::product_status`}, updated_at = clock_timestamp()
      from target t where p.id = t.id and (select valid from refs) and (${action === "update"
        ? (entries.length ? sql.join(entries.map(([key, value]) => sql`p.${sql.identifier(columns[key])} is distinct from ${value}`), sql` or `) : sql`false`)
        : action === "archive" ? sql`t.status <> 'archived'` : sql`t.status = 'archived'`})
      returning p.*`;
  return sql`with actor as materialized (${catalogActor(identity, "inventory:write", true)}),
    target as materialized (select p.*, ${safeState} as before_state from products p
      where p.id = ${id}::uuid and exists(select 1 from actor) for update of p),
    refs as materialized (select ${references} as valid),
    changed as (${changed}),
    logged as (
      insert into catalog_audit (actor_id, product_id, action, changes)
      select a.id, p.id, ${action}, jsonb_build_object('fields', ${JSON.stringify(action === "update" ? entries.map(([key]) => key) : action === "create" ? Object.keys(columns) : ["status"])}::jsonb,
        'before', (select before_state from target), 'after', ${safeState})
      from changed p cross join actor a returning id
    )
    select exists(select 1 from actor) as authorized, exists(select 1 from target) as found,
      exists(select 1 from logged) as changed, (select valid from refs) as "validReferences"`;
}
