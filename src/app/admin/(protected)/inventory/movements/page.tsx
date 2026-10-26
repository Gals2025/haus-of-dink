import Link from "next/link";
import { requirePermission } from "@/server/auth/authorize";
import { listMovements } from "@/server/inventory/service";
import { stockFilters } from "@/server/inventory/contracts";

export default async function MovementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("inventory:read");
  const params = await searchParams;
  const parsed = stockFilters.safeParse({ search: params.search, locationId: params.locationId, page: params.page });
  const { rows, filters, hasMore } = await listMovements(parsed.success ? parsed.data : {});
  const link = (page: number) => `/admin/inventory/movements?${new URLSearchParams({ search: filters.search, locationId: filters.locationId, page: String(page) })}`;
  return <div className="space-y-6"><Link href={`/admin/inventory?locationId=${filters.locationId}`} className="text-sm underline">Back to inventory</Link>
    <div><h1 className="text-4xl">Movement history</h1><p className="mt-3 text-muted-foreground">A permanent record of stock receipts, reservations and corrections. Times shown in Philippine time.</p></div>
    {!parsed.success && <p role="alert">Invalid filters. Showing the first page.</p>}
    <form action="/admin/inventory/movements" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
      <input type="hidden" name="locationId" value={filters.locationId} /><label className="flex-1 text-sm">Search SKU or reference<input name="search" maxLength={100} defaultValue={filters.search} className="mt-1 block w-full rounded-md border bg-background p-2" /></label><button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Search</button></form>
    <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full text-left text-sm"><caption className="sr-only">Stock movements for the selected location</caption>
      <thead className="border-b bg-muted/50"><tr>{["When / who", "SKU / location", "Movement", "Qty", "On hand", "Reserved", "Reason / reference"].map((label) => <th key={label} scope="col" className="whitespace-nowrap p-4">{label}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id} className="border-b last:border-0">
        <td className="whitespace-nowrap p-4"><p>{new Date(row.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</p><p className="mt-1 text-xs text-muted-foreground">{row.actor}</p></td>
        <td className="p-4"><p>{row.sku}</p><p className="text-xs text-muted-foreground">{row.location}</p></td><td className="p-4 text-xs">{row.type.replaceAll("_", " ")}</td>
        <td className="p-4 tabular-nums">{row.quantity}</td><td className="whitespace-nowrap p-4 tabular-nums">{row.beforeOnHand} → {row.afterOnHand}</td><td className="whitespace-nowrap p-4 tabular-nums">{row.beforeReserved} → {row.afterReserved}</td>
        <td className="min-w-48 p-4"><p>{row.reason}</p><p className="mt-1 text-xs text-muted-foreground">{row.reference || "No reference"}</p><p className="mt-1 break-all text-xs text-muted-foreground">{row.id}</p></td>
      </tr>)}{rows.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No movements yet.</td></tr>}</tbody></table></div>
    <nav aria-label="Movement pages" className="flex gap-4 text-sm">{filters.page > 1 && <Link href={link(filters.page - 1)}>Previous</Link>}<span>Page {filters.page}</span>{hasMore && <Link href={link(filters.page + 1)}>Next</Link>}</nav>
  </div>;
}
