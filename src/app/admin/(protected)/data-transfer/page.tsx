import Link from "next/link";
import { requirePermission } from "@/server/auth/authorize";
import { ImportPanel } from "./import-panel";

export default async function DataTransferPage() {
  await requirePermission("inventory:read");
  return <main className="mx-auto max-w-5xl space-y-8">
    <header><p className="text-xs tracking-widest text-primary">HAUS OF DINK / CATALOG TOOLS</p><h1 className="mt-3 text-4xl">Product & inventory import/export</h1><p className="mt-3 text-muted-foreground">Use CSV templates to move catalog and stock data in bulk.</p></header>
    <div className="grid gap-5 md:grid-cols-2">
      <section className="space-y-3 rounded-xl border bg-card p-5"><h2 className="text-xl">Products</h2><p className="text-sm text-muted-foreground">One row per SKU. Prices use integer centavos. Existing products match by slug and SKUs match by SKU. Brand and category must already exist.</p><div className="flex flex-wrap gap-3"><a className="rounded-md border px-4 py-2 text-sm" href="/api/admin/data-transfer?kind=products&template=1">Download template</a><a className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" href="/api/admin/data-transfer?kind=products">Export products</a></div></section>
      <section className="space-y-3 rounded-xl border bg-card p-5"><h2 className="text-xl">Inventory</h2><p className="text-sm text-muted-foreground">One row per SKU and location. Enter target on-hand quantity. The import records the difference in inventory history and leaves reservations unchanged.</p><div className="flex flex-wrap gap-3"><a className="rounded-md border px-4 py-2 text-sm" href="/api/admin/data-transfer?kind=inventory&template=1">Download template</a><a className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" href="/api/admin/data-transfer?kind=inventory">Export inventory</a></div></section>
    </div>
    <div className="grid gap-5 md:grid-cols-2"><ImportPanel kind="products" /><ImportPanel kind="inventory" /></div>
    <p className="text-sm text-muted-foreground">CSV files only; maximum 100 rows and 500 KB per upload. Review the row format summary before confirming. Rows that fail during import are reported by row number.</p>
    <Link className="text-sm underline" href="/admin/products">Back to products</Link>
  </main>;
}
