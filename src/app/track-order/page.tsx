import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";
type Track = { id: string; status: string; fulfillment: string; payment: string; holdExpiresAt: string|null; updatedAt: string };
async function lookup(reference: string): Promise<Track|null> {
  if (!z.uuid().safeParse(reference).success) return null;
  const h=await headers();
  const source=process.env.VERCEL ? h.get("x-vercel-forwarded-for") ?? "unknown" : "local";
  const key=`track:${createHash("sha256").update(source).digest("hex")}`;
  const result=await getDb().execute<Track>(sql`with throttle as (
    insert into rate_limit(id,key,count,last_request) values(${key},${key},1,(extract(epoch from clock_timestamp())*1000)::bigint)
    on conflict(key) do update set count=case when rate_limit.last_request < (extract(epoch from clock_timestamp())*1000)::bigint-600000 then 1 else rate_limit.count+1 end,
      last_request=(extract(epoch from clock_timestamp())*1000)::bigint returning count
    ) select o.id,o.status,o.fulfillment_method as fulfillment,o.payment_status as payment,o.hold_expires_at::text as "holdExpiresAt",o.updated_at::text as "updatedAt"
      from orders o,throttle where o.id=${reference}::uuid and throttle.count<=20`);
  return result.rows[0] ?? null;
}
const labels: Record<string,string> = { awaiting_confirmation:"Awaiting admin confirmation",confirmed:"Confirmed",ready_for_pickup:"Ready for pickup",out_for_delivery:"Out for delivery",fulfilled:"Completed",cancelled:"Cancelled",pending:"Processing" };
export default async function TrackOrder({searchParams}:{searchParams:Promise<{reference?:string}>}) {
  const reference=(await searchParams).reference?.trim() ?? "";
  const order=reference ? await lookup(reference) : null;
  return <main className="mx-auto max-w-xl space-y-6 px-4 py-12">
    <h1 className="text-3xl">Track your order</h1>
    <p className="text-sm text-muted-foreground">Enter the order reference shown after checkout. Keep it private; anyone with the reference can view basic order progress.</p>
    <form className="space-y-3" method="get"><label className="block text-sm font-medium">Order reference<input name="reference" required maxLength={36} defaultValue={reference} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="mt-1.5 min-h-11 w-full rounded-lg border bg-white px-3 py-2 font-mono text-sm"/></label><button className="min-h-11 rounded-lg bg-primary px-5 font-semibold text-primary-foreground">Track order</button></form>
    {reference && (order ? <section className="space-y-3 rounded-xl border bg-white p-5" aria-live="polite"><h2 className="text-xl">{labels[order.status] ?? order.status}</h2><p>Order reference: <span className="font-mono text-sm">{order.id}</span></p><p>Fulfillment: {order.fulfillment}</p><p>Payment: {order.payment}</p>{order.fulfillment==="pickup"&&order.holdExpiresAt&&order.payment==="unpaid"&&<p>Pickup reservation expires: {new Date(order.holdExpiresAt).toLocaleString("en-PH",{timeZone:"Asia/Manila"})}</p>}{order.status==="cancelled"&&<p>Your order was cancelled. Please contact the store if you need help.</p>}</section> : <p role="status" className="rounded-lg bg-muted p-4 text-sm">No matching order was found, or too many tracking attempts were made. Check the reference and try again later.</p>)}
  </main>;
}
