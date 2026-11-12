import Link from "next/link";
import { requirePermission,hasPermission } from "@/server/auth/authorize";
import { listStoreLocations } from "@/server/inventory/locations";
import { LocationForm } from "./location-form";
export default async function StoreLocationsPage() {
 const identity=await requirePermission("inventory:read");
 const locations=await listStoreLocations();
 return <div className="max-w-3xl space-y-6"><h1 className="text-3xl">Store locations</h1>
 <p className="text-muted-foreground">Add branches, stockrooms, or warehouses to use in Inventory and Point of sale. Each location holds its own counted stock.</p>
 {hasPermission(identity.staff.role,"inventory:write")?<LocationForm/>:<p className="text-sm text-muted-foreground">Only administrators can add store locations.</p>}
 <section className="rounded-xl border bg-card p-5"><h2 className="mb-4 text-xl">Existing locations ({locations.length})</h2><ul className="divide-y">{locations.map(location=><li key={location.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><span className="min-w-0 flex-1 break-words font-medium">{location.name}</span><Link href={`/admin/inventory?locationId=${location.id}`} className="min-h-11 py-3 text-sm underline">View inventory</Link></li>)}</ul>{!locations.length&&<p className="text-sm text-muted-foreground">No locations yet. Add the first location above.</p>}</section>
 <p className="text-sm text-muted-foreground">New locations start with no counted stock. Receive stock in Inventory before selling counted items there. Availability-only items follow their existing availability setting. Stock counting changes require a physical count for every location, including newly added locations.</p>
 <div className="flex flex-wrap gap-4 text-sm"><Link href="/admin/inventory" className="underline">Back to inventory</Link><Link href="/admin/pos" className="underline">Open point of sale</Link></div></div>;
}
