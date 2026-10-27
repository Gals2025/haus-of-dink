import Link from "next/link";
import { requirePermission } from "@/server/auth/authorize";
import { getReport,reportFilters } from "@/server/commerce/service";
import { peso } from "@/server/commerce/contracts";
export default async function Reports({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  await requirePermission("reports:read"); const params=await searchParams;
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const parsed=reportFilters.safeParse({start:params.start??`${today.slice(0,7)}-01`,end:params.end??today});
  if(!parsed.success)return <div className="space-y-4"><h1 className="text-3xl">Reports</h1><p role="alert">Choose valid dates in order, with a range of up to 366 days.</p><Link className="underline" href="/admin/reports">Reset dates</Link></div>;
  const {start,end}=parsed.data;const report=await getReport(parsed.data);
  const metrics=[["All orders",String(report.orders)],["Pending",String(report.pending)],["Cancelled",String(report.cancelled)],["Fulfilled sales (incl. shipping)",peso(Number(report.revenue))],["Discounts on fulfilled orders",peso(Number(report.discounts))],["Paid pending orders",peso(Number(report.deposits))],["Shipping on fulfilled orders",peso(Number(report.shipping))],[report.missingCost?"Known product costs (incomplete)":"Product costs",peso(Number(report.cost))],...(!report.missingCost?[["Merchandise gross profit",peso(Number(report.revenue)-Number(report.shipping)-Number(report.cost))]]:[])];
  return <div className="space-y-6"><h1 className="text-3xl">Sales reports</h1><p className="text-muted-foreground">Grouped by order creation date in Philippine time. Sales include fulfilled orders only; pending deposits are shown separately. Prices and costs are snapshots from order creation.</p>
    <form className="flex flex-wrap items-end gap-3"><label>From<input required name="start" type="date" defaultValue={start} className="mt-1 block rounded-md border bg-background p-2"/></label><label>Through<input required name="end" type="date" defaultValue={end} className="mt-1 block rounded-md border bg-background p-2"/></label><button className="rounded-md border px-4 py-2">Apply dates</button><a href={`/admin/reports/export?${new URLSearchParams({start,end})}`} className="px-3 py-2 underline">Download daily CSV</a></form>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{metrics.map(([label,value])=><div key={label} className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-2xl">{value}</p></div>)}</div>
    {report.missingCost>0&&<p role="status">Gross profit is unavailable: {report.missingCost} fulfilled order line(s) have no recorded cost.</p>}
    <div className="overflow-auto rounded-xl border bg-card"><table className="w-full text-left text-sm"><caption className="p-4 text-left text-lg">Daily fulfilled sales</caption><thead><tr><th className="p-4">Date (PH)</th><th className="p-4">Orders</th><th className="p-4">Sales (PHP)</th></tr></thead><tbody>{report.daily.map(d=><tr key={d.day} className="border-t"><td className="p-4">{d.day}</td><td className="p-4">{d.orders}</td><td className="p-4">{peso(Number(d.revenue))}</td></tr>)}</tbody></table>{!report.daily.length&&<p className="p-4">No fulfilled sales in this range.</p>}</div>
  </div>;
}
