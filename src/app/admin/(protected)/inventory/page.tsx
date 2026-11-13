import Link from "next/link";
import { productsNeedingSetup } from "@/server/purchasing/service";
import { ReorderForm } from "./reorder-form";
import { requirePermission, hasPermission } from "@/server/auth/authorize";
import { listStock } from "@/server/inventory/service";
import { stockFilters } from "@/server/inventory/contracts";

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const identity = await requirePermission("inventory:read");
  const params = await searchParams;
  const parsed = stockFilters.safeParse({ search: params.search, status: params.status, locationId: params.locationId, page: params.page });
  const { rows, hasMore, locations, filters } = await listStock(parsed.success ? parsed.data : {},true);
  const setup=await productsNeedingSetup(filters.search);
  const grouped=Map.groupBy(rows,r=>r.productId);
  const link = (page: number) => `/admin/inventory?${new URLSearchParams({ ...filters, page: String(page) })}`;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs tracking-widest text-primary">HAUS OF DINK / STOCKROOM</p>
      <h1 className="mt-3 text-4xl">Inventory</h1><p className="mt-3 text-muted-foreground">Available stock = on hand − reserved. Every stock change has a history.</p></div>
      <div className="flex flex-wrap gap-3"><Link href={`/admin/inventory/receiving?locationId=${filters.locationId}`} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Receive stock</Link><Link href="/admin/inventory/suppliers" className="rounded-md border px-4 py-2 text-sm">Suppliers & costs</Link><Link href="/admin/inventory/locations" className="rounded-md border bg-card px-4 py-2 text-sm">Store locations</Link><Link href="/admin/inventory/modes" className="rounded-md border bg-card px-4 py-2 text-sm">Stock counting & availability</Link><Link href="/admin/data-transfer" className="rounded-md border bg-card px-4 py-2 text-sm">Import / export</Link><Link href={`/admin/inventory/movements?locationId=${filters.locationId}`} className="rounded-md border bg-card px-4 py-2 text-sm">Movement history</Link></div></div>
    {!parsed.success && <p role="alert">Invalid filters. Showing the first page.</p>}
    <form action="/admin/inventory" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
      <label className="min-w-40 flex-1 text-sm">Search product or SKU<input name="search" defaultValue={filters.search} maxLength={100} className="mt-1 block w-full rounded-md border bg-background p-2" /></label>
      <label className="text-sm">Location<select name="locationId" defaultValue={filters.locationId} className="mt-1 block rounded-md border bg-background p-2">{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
      <label className="text-sm">Stock status<select name="status" defaultValue={filters.status} className="mt-1 block rounded-md border bg-background p-2"><option value="all">All stock</option><option value="low">At or below reorder level</option><option value="out">Out of stock</option></select></label>
      <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Apply filters</button>
    </form>
    <div className="space-y-3">{[...grouped].map(([id,items])=><section key={id} className="rounded-xl border bg-card p-4"><div className="flex flex-wrap justify-between gap-3"><Link className="text-lg underline" href={`/admin/products/${id}`}>{items[0]!.name}</Link>{hasPermission(identity.staff.role,"inventory:write")&&<Link className="underline" href={`/admin/inventory/receiving?productId=${id}&locationId=${filters.locationId}`}>Receive stock</Link>}</div>
      {items.length===1?<StockDetails row={items[0]!} locationId={filters.locationId} canWrite={hasPermission(identity.staff.role,"inventory:write")}/>:<details className="mt-3"><summary>{items.length} physical variants — expand stock details</summary>{items.map(row=><StockDetails key={row.variantId} row={row} locationId={filters.locationId} canWrite={hasPermission(identity.staff.role,"inventory:write")}/>)}</details>}</section>)}
      {!rows.length&&<p>No matching inventory items.</p>}
      {setup.length>0&&<section className="rounded border p-4"><h2 className="text-2xl">Setup needed</h2><p className="my-2 text-sm">These existing products need a selling price and SKU before receiving stock. No price has been assumed. Showing up to 100 matching products.</p>{setup.map(p=><p key={p.id}><Link className="underline" href={`/admin/products/${p.id}`}>{p.name} — set up selling item</Link></p>)}</section>}
    </div>
    <nav aria-label="Inventory pages" className="flex gap-4 text-sm">{filters.page > 1 && <Link href={link(filters.page - 1)}>Previous</Link>}<span>Page {filters.page}</span>{hasMore && <Link href={link(filters.page + 1)}>Next</Link>}</nav>
    {hasPermission(identity.staff.role, "inventory:write") && <Link href="/admin/products/new" className="inline-block text-sm underline">Add a product</Link>}
  </div>;
}

function StockDetails({row,locationId,canWrite}:{row:import("@/server/inventory/contracts").StockRow;locationId:string;canWrite:boolean}) {
 return <div className="mt-3 space-y-3 border-t pt-3"><p className="text-xs text-muted-foreground">SKU {row.sku}</p><div className="flex flex-wrap items-start gap-6 text-sm">
 <p>Availability<br/><strong>{!row.salesEnabled?"Sales paused":row.inventoryMode==="availability_only"?"Available":`${row.available} available`}</strong></p>
 {row.inventoryMode==="counted"&&<><p>On hand<br/><strong>{row.onHand}</strong></p><p>Reserved<br/><strong>{row.reserved}</strong></p><p>Total stock cost<br/><strong>{row.stockValue===null?"Needs valuation":`₱${(Number(row.stockValue)/100).toFixed(2)}`}</strong></p><div>Reorder level{canWrite?<ReorderForm variantId={row.variantId} locationId={locationId} sku={row.sku} level={row.reorderLevel}/>:<p>{row.reorderLevel}</p>}</div></>}
 {canWrite&&row.inventoryMode==="counted"&&<Link className="underline" href={`/admin/inventory/adjustments?variantId=${row.variantId}&locationId=${locationId}`}>Opening stock / correction</Link>}
 </div></div>;
}
