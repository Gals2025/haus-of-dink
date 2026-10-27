import Link from "next/link";
import { requirePermission } from "@/server/auth/authorize";
import { getOrderOptions } from "@/server/commerce/service";
import { OrderComposer } from "../../commerce/forms";
export default async function NewOrder() {
  await requirePermission("orders:write");const options=await getOrderOptions();
  return <div className="max-w-4xl space-y-6"><Link href="/admin/orders" className="underline">Back to orders</Link><h1 className="text-3xl">New order</h1>
    {!options.customers.length?<p><Link href="/admin/customers" className="underline">Add an active customer</Link> before creating an order.</p>:!options.locations.length||!options.variants.length?<p>Activate products and PHP variants, then receive stock at an inventory location before creating orders.</p>:<div className="rounded-xl border bg-card p-5"><OrderComposer options={options}/></div>}</div>;
}
