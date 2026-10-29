import "server-only";
import { z } from "zod";
import { getPermissionSession } from "@/server/auth/authorize";
import { getDb } from "@/server/db";
import { managementLock } from "@/server/admin/queries";
import { commerceInput, filtersInput, type OrderDetail } from "./contracts";
import { commerceWrite, commerceList, writePermission, orderDetailQuery, orderOptionsQuery, reportQuery, type Area } from "./queries";
export type Result = { ok: true; id: string } | { ok: false; error: string };
export function createCommerce(deps: { authorize: typeof getPermissionSession; write: (query: ReturnType<typeof commerceWrite>) => Promise<string | undefined> }) {
  return async (requestId: unknown, input: unknown): Promise<Result> => {
    const parsed = commerceInput.safeParse(input);
    if (!parsed.success || !z.uuid().safeParse(requestId).success) return { ok: false, error: parsed.success ? "Invalid request. Refresh and retry." : parsed.error.issues[0]?.message ?? "Invalid input." };
    try {
      const identity = await deps.authorize(writePermission(parsed.data));
      if (!identity) return { ok: false, error: "Access denied. Sign in with an authorized account." };
      const id = await deps.write(commerceWrite(identity, requestId as string, parsed.data));
      return id ? { ok: true, id } : { ok: false, error: "Access denied. Your account or session changed." };
    } catch {
      return { ok: false, error: "Unable to save. Check for duplicate email/code, available stock, valid promotion, and current order/payment status. Refresh before retrying." };
    }
  };
}
export const mutateCommerce = createCommerce({ authorize: getPermissionSession, write: async query => {
  const db = getDb(); const [, result] = await db.batch([db.execute(managementLock), db.execute<{id:string}>(query)]);
  return result.rows[0]?.id;
} });
export async function listCommerce<T>(area: Area, input: unknown) {
  const filters = filtersInput.parse(input);
  const identity = await getPermissionSession(`${area}:read`);
  if (!identity) throw Error("Access denied.");
  const result = await getDb().execute<{authorized:boolean;rows:T[]}>(commerceList(identity,area,filters));
  const row=result.rows[0]; if(!row?.authorized) throw Error("Access denied.");
  return { rows:row.rows.slice(0,25),hasMore:row.rows.length>25,filters };
}
export async function getOrder(id: string) {
  if(!z.uuid().safeParse(id).success) return null;
  const identity = await getPermissionSession("orders:read"); if(!identity) throw Error("Access denied.");
  return (await getDb().execute<OrderDetail>(orderDetailQuery(identity,id))).rows[0] ?? null;
}
export type OrderOptions = { authorized: boolean; customers: {id:string;name:string;email:string|null}[]; locations: {id:string;name:string}[]; variants: {id:string;name:string;sku:string;price:number}[] };
export async function getOrderOptions() {
  const identity = await getPermissionSession("orders:write"); if(!identity) throw Error("Access denied.");
  const result=(await getDb().execute<OrderOptions>(orderOptionsQuery(identity))).rows[0];
  if(!result?.authorized) throw Error("Access denied."); return result;
}
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d=new Date(v); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===v; });
export const reportFilters = z.object({start:date,end:date}).refine(v=>v.start<=v.end && new Date(v.end).getTime()-new Date(v.start).getTime()<=366*86400000,"Choose a range of up to 366 days.");
export type Report = { authorized:boolean;orders:number;pending:number;cancelled:number;revenue:string;discounts:string;shipping:string;deposits:string;cost:string;missingCost:number;daily:{day:string;orders:number;revenue:string}[] };
export async function getReport(input: unknown) {
  const filters=reportFilters.parse(input); const identity=await getPermissionSession("reports:read"); if(!identity) throw Error("Access denied.");
  const report=(await getDb().execute<Report>(reportQuery(identity,filters.start,filters.end))).rows[0];
  if(!report?.authorized) throw Error("Access denied."); return report;
}
