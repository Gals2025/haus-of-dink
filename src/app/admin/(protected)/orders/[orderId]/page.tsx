import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission,hasPermission } from "@/server/auth/authorize";
import { getOrder } from "@/server/commerce/service";
import { peso } from "@/server/commerce/contracts";
import { OrderControls } from "../../commerce/forms";
import { formatDate } from "../../commerce/list";
export default async function OrderPage({params}:{params:Promise<{orderId:string}>}) {
  const identity=await requirePermission("orders:read"); const order=await getOrder((await params).orderId);if(!order)notFound();const c=order.customerSnapshot;
  return <div className="space-y-6"><Link href="/admin/orders" className="underline">Back to orders</Link><h1 className="break-all text-3xl">Order {order.id.slice(0,8).toUpperCase()}</h1><p className="text-sm text-muted-foreground">Full reference: {order.id} · {formatDate(order.createdAt)}</p>
    <div className="grid gap-4 sm:grid-cols-2"><section className="rounded-xl border bg-card p-5"><h2 className="mb-2 text-xl">Customer at time of order</h2><p>{c.name}</p><p>{c.email}</p><p>{c.phone}</p><p className="whitespace-pre-wrap">{c.address}</p></section><section className="rounded-xl border bg-card p-5"><h2 className="mb-2 text-xl">Order details</h2><p>Status: {order.status}</p><p>Payment: {order.paymentStatus}</p><p>Reference: {order.paymentReference||"—"}</p><p>Stock location: {order.location}</p><p className="whitespace-pre-wrap">Notes: {order.notes||"—"}</p></section></div>
    <div className="overflow-auto rounded-xl border bg-card"><table className="w-full text-left text-sm"><caption className="sr-only">Order items</caption><thead><tr>{["Product / SKU","Quantity","Unit price","Line total"].map(h=><th key={h} className="p-4">{h}</th>)}</tr></thead><tbody>{order.items.map(i=><tr key={i.sku} className="border-t"><td className="p-4">{i.name}<br/>{i.sku}</td><td className="p-4">{i.quantity}</td><td className="p-4">{peso(i.unitPrice)}</td><td className="p-4">{peso(i.unitPrice*i.quantity)}</td></tr>)}</tbody></table></div>
    <dl className="ml-auto grid max-w-sm grid-cols-2 gap-2"><dt>Subtotal</dt><dd>{peso(order.subtotal)}</dd><dt>Discount {order.promotionCode}</dt><dd>−{peso(order.discount)}</dd><dt>Shipping</dt><dd>{peso(order.shippingFee)}</dd><dt className="font-semibold">Total</dt><dd className="font-semibold">{peso(order.total)}</dd></dl>
    {hasPermission(identity.staff.role,"orders:write")&&<section className="rounded-xl border bg-card p-5"><h2 className="mb-4 text-xl">Order actions</h2><OrderControls order={order}/></section>}
    <section><h2 className="mb-3 text-xl">Order history</h2><ol className="space-y-2 text-sm">{order.history.map((h,i)=><li key={i}>{formatDate(h.createdAt)} · {h.action.replace("order.","")} · {h.actor}</li>)}</ol></section>
  </div>;
}
