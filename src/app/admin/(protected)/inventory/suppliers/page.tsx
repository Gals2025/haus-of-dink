import Link from "next/link";
import { requirePermission } from "@/server/auth/authorize";
import { purchasingOptions,valuationHistory } from "@/server/purchasing/service";
import { SupplierForm,ValuationForm } from "./supplier-form";
export default async function SuppliersPage(){
 await requirePermission("inventory:write");const [options,history]=await Promise.all([purchasingOptions(),valuationHistory()]);
 return <div className="max-w-4xl space-y-6"><Link className="underline" href="/admin/inventory">Back to inventory</Link><h1 className="text-4xl">Suppliers & purchase costs</h1><SupplierForm options={options}/><ValuationForm options={options}/><section className="space-y-3"><h2 className="text-2xl">Valuation corrections (latest 100)</h2>{history.map(h=><div className="rounded border p-3" key={h.id}><p>{h.name} · {h.sku} · {h.location}</p><p>{h.beforeValue===null?"Unknown":`₱${(Number(h.beforeValue)/100).toFixed(2)}`} → ₱{(Number(h.afterValue)/100).toFixed(2)}</p><p className="text-sm">{h.reason} · {h.createdAt}</p></div>)}</section></div>;
}
