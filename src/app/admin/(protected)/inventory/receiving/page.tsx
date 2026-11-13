import Link from "next/link";
import { requirePermission } from "@/server/auth/authorize";
import { purchasingOptions,purchasingHistory } from "@/server/purchasing/service";
import { listProductOptions } from "@/server/catalog/service";
import { ReceivingForm } from "./receiving-form";
export default async function ReceivingPage({searchParams}:{searchParams:Promise<{variantId?:string;productId?:string;locationId?:string}>}) {
 await requirePermission("inventory:write");
 const [options,productOptions,receipts,params]=await Promise.all([purchasingOptions(),listProductOptions(),purchasingHistory(),searchParams]);
 return <div className="space-y-6"><Link href="/admin/inventory" className="underline">Back to inventory</Link><h1 className="text-4xl">Receive stock</h1><Link href="/admin/inventory/locations" className="inline-block underline">Manage store locations</Link>
 {productOptions.ok&&<ReceivingForm options={options} productOptions={productOptions} initialLocation={params.locationId} initialVariant={params.variantId??options.variants.find(v=>v.productId===params.productId)?.id}/>}
 <section className="space-y-3"><h2 className="text-2xl">Posted deliveries (latest 100)</h2><p className="text-sm">Receipts are permanent. Use a reasoned stock adjustment for quantity corrections and a valuation correction for remaining stock value.</p>{receipts.map(r=><details key={r.id} className="rounded border bg-card p-4"><summary>{r.deliveryDate} · {r.supplier} · {r.location} · ₱{(Number(r.total)/100).toFixed(2)} · {r.reference}</summary><p className="mt-2 break-all text-xs">Receipt {r.id}</p>{r.lines.map(l=><p className="mt-2 text-sm" key={l.sku}>{l.name} ({l.sku}) · {l.quantity} × ₱{(l.unitCost/100).toFixed(2)}{l.counted?"":" · purchase only, not counted"}</p>)}</details>)}{!receipts.length&&<p>No deliveries yet.</p>}</section></div>;
}
