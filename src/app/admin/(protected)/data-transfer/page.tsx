import Link from "next/link";
import { requirePermission } from "@/server/auth/authorize";
import { ImportPanel } from "./import-panel";
import { DownloadLinks } from "./download-links";

export default async function DataTransferPage() {
  await requirePermission("inventory:read");
  return <main className="mx-auto max-w-5xl space-y-8">
    <header><p className="text-xs tracking-widest text-primary">HAUS OF DINK / CATALOG TOOLS</p><h1 className="mt-3 text-4xl">Product & inventory import/export</h1><p className="mt-3 text-muted-foreground">Use CSV or Excel templates to move catalog and stock data in bulk.</p></header>
    <div className="grid gap-5 md:grid-cols-2">
      <section className="space-y-3 rounded-xl border bg-card p-5"><h2 className="text-xl">Products</h2><p className="text-sm text-muted-foreground">One row per SKU. Prices use integer centavos. Existing products match by slug and SKUs match by SKU. Brand and category must already exist.</p><DownloadLinks kind="products" /></section>
      <section className="space-y-3 rounded-xl border bg-card p-5"><h2 className="text-xl">Inventory</h2><p className="text-sm text-muted-foreground">One row per SKU and location. Enter target on-hand quantity. The import records the difference in inventory history and leaves reservations unchanged.</p><DownloadLinks kind="inventory" /></section>
    </div>
    <div className="grid gap-5 md:grid-cols-2"><ImportPanel kind="products" /><ImportPanel kind="inventory" /></div>
    <p className="text-sm text-muted-foreground">CSV, XLS and XLSX files accepted; maximum 100 rows and 500 KB per upload. Excel imports read the first worksheet only. Keep SKUs and barcodes as text to preserve leading zeros. Review the row format summary before confirming. Rows that fail during import are reported by row number.</p>
    <Link className="text-sm underline" href="/admin/products">Back to products</Link>
  </main>;
}
