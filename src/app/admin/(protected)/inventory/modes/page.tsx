import Link from "next/link";
import { requirePermission,hasPermission } from "@/server/auth/authorize";
import { listInventoryModes } from "@/server/inventory/modes";
import { DefaultEditor,ModeEditor } from "./editor";
export default async function InventoryModes({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const identity=await requirePermission("inventory:read");
  const params=await searchParams;
  const search=typeof params.search==="string"?params.search.slice(0,100):"";
  const page=Math.max(1,Math.min(10000,Number(params.page)||1));
  const data=await listInventoryModes(search,Math.floor(page));
  const link=(n:number)=>`/admin/inventory/modes?${new URLSearchParams({search,page:String(n)})}`;
  return <div className="space-y-6"><h1 className="text-3xl">Stock counting & availability</h1><p>Availability-only items need no quantity and stay available until you turn them off. Counted items use stock balances and reservations. Pausing sales blocks new purchases; existing orders can still be fulfilled.</p><p>To change mode, first finish or cancel open orders and reservations. When enabling counting, enter the physical quantity at every location, including zero. All selected changes save together and history is preserved.</p>
    {hasPermission(identity.staff.role,"settings:write")&&<DefaultEditor mode={data.defaultMode}/>}
    <form className="flex gap-3"><input name="search" defaultValue={search} placeholder="Search product or SKU" aria-label="Search product or SKU" className="rounded-md border bg-background p-2"/><button className="rounded-md border p-2">Search</button></form>
    <ModeEditor rows={data.rows} locations={data.locations} canWrite={hasPermission(identity.staff.role,"inventory:write")}/>
    <nav className="flex gap-4">{page>1&&<Link href={link(page-1)}>Previous</Link>}<span>Page {page}</span>{data.hasMore&&<Link href={link(page+1)}>Next</Link>}</nav><Link href="/admin/inventory" className="underline">Back to inventory</Link>
  </div>;
}
