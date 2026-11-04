import "server-only";
import { sql } from "drizzle-orm";
import { getPermissionSession } from "@/server/auth/authorize";
import { getDb } from "@/server/db";
import { managementLock } from "@/server/admin/queries";
import { catalogActor } from "@/server/catalog/queries";
import { posProductsQuery } from "./queries";
import { posSaleInput, type PosLocation, type PosProduct } from "./contracts";

export async function getPosOptions() {
  const identity = await getPermissionSession("pos:sell");
  if (!identity) throw new Error("Access denied.");
  const db = getDb();
  const [locationResult, productResult] = await Promise.all([
    db.execute<PosLocation>(sql`with actor as materialized (${catalogActor(identity, "pos:sell")})
      select id, name from inventory_locations where exists(select 1 from actor) order by name`),
    db.execute<PosProduct>(posProductsQuery(identity)),
  ]);
  return { locations: locationResult.rows, products: productResult.rows };
}

export type PosSaleResult = { ok: true; id: string } | { ok: false; error: string };

export async function createPosSale(input: unknown): Promise<PosSaleResult> {
  const parsed = posSaleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the sale details." };
  const identity = await getPermissionSession("pos:sell");
  if (!identity) return { ok: false, error: "Access denied. Sign in with an authorized account." };
  try {
    const db = getDb();
    const payload = { ...parsed.data, action: "pos.sale" };
    const query = sql`with actor as materialized (${catalogActor(identity, "pos:sell", true)})
      select pos_execute(actor.id, ${parsed.data.requestId}::uuid, ${JSON.stringify(payload)}::jsonb) as id from actor`;
    const [, result] = await db.batch([db.execute(managementLock), db.execute<{ id: string }>(query)]);
    const id = result.rows[0]?.id;
    return id ? { ok: true, id } : { ok: false, error: "Access denied. Your account or session changed." };
  } catch {
    return { ok: false, error: "Unable to complete the sale. Check stock and payment, then refresh before retrying." };
  }
}
