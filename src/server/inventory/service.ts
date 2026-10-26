import "server-only";
import { getPermissionSession } from "@/server/auth/authorize";
import { getDb } from "@/server/db";
import { managementLock } from "@/server/admin/queries";
import { stockChange, stockFilters, pageSize, type StockResult, type StockRow, type MovementRow } from "./contracts";
import { applyStockQuery, inventoryPermission, stockQuery, locationsQuery, movementsQuery } from "./queries";

export function createInventory(deps: {
  authorize: typeof getPermissionSession;
  apply: (query: ReturnType<typeof applyStockQuery>) => Promise<string | undefined>;
}) {
  return { async change(input: unknown): Promise<StockResult> {
    const parsed = stockChange.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the SKU, quantity, reason and reservation details." };
    const identity = await deps.authorize(inventoryPermission(parsed.data.type));
    if (!identity) return { ok: false, error: "Access denied. Sign in with an authorized account." };
    const id = await deps.apply(applyStockQuery(identity, parsed.data));
    return id ? { ok: true, movementId: id } : { ok: false, error: "Access denied. Your account or session may have changed." };
  } };
}
export const inventory = createInventory({
  authorize: getPermissionSession,
  apply: async (query) => {
    const db = getDb();
    const [, result] = await db.batch([db.execute(managementLock), db.execute<{ id: string }>(query)]);
    return result.rows[0]?.id;
  },
});
export async function listStock(input: unknown) {
  const identity = await getPermissionSession("inventory:read");
  if (!identity) throw new Error("Access denied.");
  const filters = stockFilters.parse(input);
  const db = getDb();
  const [result, locations] = await Promise.all([
    db.execute<StockRow>(stockQuery(identity, filters)),
    db.execute<{ id: string; name: string }>(locationsQuery(identity)),
  ]);
  return { rows: result.rows.slice(0, pageSize), hasMore: result.rows.length > pageSize, locations: locations.rows, filters };
}
export async function listMovements(input: unknown) {
  const identity = await getPermissionSession("inventory:read");
  if (!identity) throw new Error("Access denied.");
  const filters = stockFilters.parse(input);
  const result = await getDb().execute<MovementRow>(movementsQuery(identity, filters));
  return { rows: result.rows.slice(0, pageSize), hasMore: result.rows.length > pageSize, filters };
}
