import Link from "next/link";
import { ReorderForm } from "./reorder-form";
import { requirePermission, hasPermission } from "@/server/auth/authorize";
import { listStock } from "@/server/inventory/service";
import { stockFilters } from "@/server/inventory/contracts";

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const identity = await requirePermission("inventory:read");
  const params = await searchParams;
  const parsed = stockFilters.safeParse({ search: params.search, status: params.status, locationId: params.locationId, page: params.page });
  const { rows, hasMore, locations, filters } = await listStock(parsed.success ? parsed.data : {});
  const link = (page: number) => `/admin/inventory?${new URLSearchParams({ ...filters, page: String(page) })}`;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs tracking-widest text-primary">HAUS OF DINK / STOCKROOM</p>
      <h1 className="mt-3 text-4xl">Inventory</h1><p className="mt-3 text-muted-foreground">Available stock = on hand − reserved. Every stock change has a history.</p></div>
      <Link href={`/admin/inventory/movements?locationId=${filters.locationId}`} className="rounded-md border bg-card px-4 py-2 text-sm">Movement history</Link></div>
    {!parsed.success && <p role="alert">Invalid filters. Showing the first page.</p>}
    <form action="/admin/inventory" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
      <label className="min-w-40 flex-1 text-sm">Search product or SKU<input name="search" defaultValue={filters.search} maxLength={100} className="mt-1 block w-full rounded-md border bg-background p-2" /></label>
      <label className="text-sm">Location<select name="locationId" defaultValue={filters.locationId} className="mt-1 block rounded-md border bg-background p-2">{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
      <label className="text-sm">Stock status<select name="status" defaultValue={filters.status} className="mt-1 block rounded-md border bg-background p-2"><option value="all">All stock</option><option value="low">At or below reorder level</option><option value="out">Out of stock</option></select></label>
      <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Apply filters</button>
    </form>
    <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full text-left text-sm"><caption className="sr-only">Inventory balances by SKU at the selected location</caption>
      <thead className="border-b bg-muted/50"><tr>{["Product / SKU", "On hand", "Reserved", "Available", "Reorder level", ""].map((label) => <th key={label} className="whitespace-nowrap p-4" scope="col">{label}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.variantId} className="border-b last:border-0"><td className="p-4"><p className="font-medium">{row.name}</p><p className="mt-1 text-xs text-muted-foreground">{row.sku}</p></td>
        <td className="p-4 tabular-nums">{row.onHand}</td><td className="p-4 tabular-nums">{row.reserved}</td>
        <td className="p-4 tabular-nums"><span className={row.available <= row.reorderLevel ? "font-semibold text-destructive" : ""}>{row.available}</span>{row.available === 0 ? <span className="ml-2 text-xs">Out of stock</span> : row.available <= row.reorderLevel ? <span className="ml-2 text-xs">Low stock</span> : null}</td>
        <td className="p-4 tabular-nums">{hasPermission(identity.staff.role, "inventory:write") ? <ReorderForm key={`${row.variantId}/${filters.locationId}/${row.reorderLevel}`} variantId={row.variantId} locationId={filters.locationId} sku={row.sku} level={row.reorderLevel} /> : row.reorderLevel}</td><td className="p-4">{hasPermission(identity.staff.role, "inventory:write") && <Link className="whitespace-nowrap underline underline-offset-4" href={`/admin/inventory/adjustments?variantId=${row.variantId}&locationId=${filters.locationId}&type=PURCHASE`}>Receive stock / record movement</Link>}</td></tr>)}
        {rows.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No matching SKUs. Clear filters to check other items. For a new product, open Products, select the product and add a SKU before receiving stock.</td></tr>}</tbody></table></div>
    <nav aria-label="Inventory pages" className="flex gap-4 text-sm">{filters.page > 1 && <Link href={link(filters.page - 1)}>Previous</Link>}<span>Page {filters.page}</span>{hasMore && <Link href={link(filters.page + 1)}>Next</Link>}</nav>
    {hasPermission(identity.staff.role, "inventory:write") && <Link href="/admin/products" className="inline-block text-sm underline">Open products to add a SKU</Link>}
  </div>;
}
