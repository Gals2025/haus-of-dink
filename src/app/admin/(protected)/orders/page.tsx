import Link from "next/link";
import { requirePermission,hasPermission } from "@/server/auth/authorize";
import { listCommerce } from "@/server/commerce/service";
import { filtersInput,peso,type Order } from "@/server/commerce/contracts";
import { ListFilters,Pagination,formatDate } from "../commerce/list";
export default async function Orders({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  const identity=await requirePermission("orders:read");const params=filtersInput.safeParse(await searchParams);
  if(!params.success)return <p role="alert">Invalid search filters.</p>;
  const data=await listCommerce<Order>("orders",params.data);
  return <div className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl">Orders</h1>{hasPermission(identity.staff.role,"orders:write")&&<Link href="/admin/orders/new" className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Create order</Link>}</div>
    <ListFilters filters={data.filters} orders/><div className="overflow-auto rounded-xl border bg-card"><table className="w-full text-left text-sm"><caption className="sr-only">Orders, payment status and totals</caption><thead><tr>{["Order","Customer","Status","Payment","Total","Created (PH)"].map(h=><th key={h} className="p-4">{h}</th>)}</tr></thead><tbody>{data.rows.map(o=><tr key={o.id} className="border-t"><td className="p-4"><Link href={`/admin/orders/${o.id}`} className="underline">{o.id.slice(0,8).toUpperCase()}</Link></td><td className="p-4">{o.customer}</td><td className="p-4"><span className={o.status==="awaiting_confirmation"?"font-semibold text-amber-700":""}>{o.status.replaceAll("_"," ")}</span></td><td className="p-4">{o.paymentStatus}</td><td className="whitespace-nowrap p-4">{peso(o.total)}</td><td className="whitespace-nowrap p-4">{formatDate(o.createdAt)}</td></tr>)}</tbody></table>{!data.rows.length&&<p className="p-5">No orders found.</p>}</div>
    <Pagination path="/admin/orders" filters={data.filters} hasMore={data.hasMore}/></div>;
}
