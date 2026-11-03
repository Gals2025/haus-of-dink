import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getPermissionSession, type AuthSession } from "../auth/authorize";
import { getDb } from "../db";
import { catalogActor } from "../catalog/queries";
import { managementLock } from "../admin/queries";

export const inventoryMode = z.enum(["availability_only", "counted"]);
export const modeChange = z.object({ variantId: z.uuid(), mode: inventoryMode.optional(), available: z.boolean().optional(), counts: z.record(z.uuid(), z.number().int().min(0).max(1000000)).default({}) }).strict();
export type ModeChange = z.infer<typeof modeChange>;
export function configureInventoryQuery(identity: AuthSession, input: ModeChange) {
  return sql`with actor as materialized (${catalogActor(identity, "inventory:write", true)})
    select inventory_configure((select id from actor),${input.variantId}::uuid,coalesce(${input.mode ?? null},(select inventory_mode from product_variants where id=${input.variantId}::uuid)),coalesce(${input.available ?? null}::boolean,(select sales_enabled from product_variants where id=${input.variantId}::uuid)),${JSON.stringify(input.counts)}::jsonb) as id`;
}
export async function configureInventory(input: unknown[]) {
  const identity = await getPermissionSession("inventory:write");
  if (!identity) throw new Error("Access denied.");
  const changes = z.array(modeChange).min(1).max(100).parse(input);
  if (new Set(changes.map(c => c.variantId)).size !== changes.length) throw new Error("Select each SKU only once.");
  const db = getDb();
  const results = await db.batch([db.execute(managementLock), ...changes.sort((a,b)=>a.variantId.localeCompare(b.variantId)).map(c => db.execute(configureInventoryQuery(identity,c)))]);
  if (results.slice(1).some(result => result.rows.length !== 1)) throw new Error("One or more SKUs are unavailable or access was revoked.");
}
export type ModeRow = { id: string; name: string; sku: string; mode: string; available: boolean };
export async function listInventoryModes(search: string, page: number) {
  const identity = await getPermissionSession("inventory:read");
  if (!identity) throw new Error("Access denied.");
  const db = getDb();
  const term = `%${search.replace(/[\\%_]/g,"\\$&")}%`;
  const [rows, locations, settings] = await Promise.all([
    db.execute<ModeRow>(sql`with actor as materialized (${catalogActor(identity,"inventory:read")}) select v.id,p.name,v.sku,v.inventory_mode as mode,v.sales_enabled as available
      from product_variants v join products p on p.id=v.product_id where exists(select 1 from actor) and (p.name ilike ${term} or v.sku ilike ${term}) order by p.name,v.sku,v.id limit 51 offset ${(page-1)*50}`),
    db.execute<{id:string;name:string}>(sql`select id,name from inventory_locations order by name,id`),
    db.execute<{mode:string}>(sql`select inventory_default_mode() as mode`),
  ]);
  return { rows:rows.rows.slice(0,50),hasMore:rows.rows.length>50,locations:locations.rows,defaultMode:settings.rows[0]?.mode ?? "availability_only" };
}
export async function saveInventoryDefault(input: unknown) {
  const mode = inventoryMode.parse(input);
  const identity = await getPermissionSession("settings:write");
  if (!identity) throw new Error("Access denied.");
  const db = getDb();
  const [,result] = await db.batch([db.execute(managementLock),db.execute(sql`with actor as materialized (${catalogActor(identity,"settings:write",true)}),
    changed as (insert into inventory_settings(id,default_mode) select 1,${mode} from actor on conflict(id) do update set default_mode=excluded.default_mode returning id)
    insert into commerce_audit(request_id,actor_id,entity_id,action,payload) select gen_random_uuid(),actor.id,'00000000-0000-4000-8000-000000000001'::uuid,'inventory.default',jsonb_build_object('mode',${mode}::text) from actor cross join changed returning id`)]);
  if (!result.rows.length) throw new Error("Access denied.");
}
