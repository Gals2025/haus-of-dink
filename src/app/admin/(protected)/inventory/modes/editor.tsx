"use client";
import { useActionState, useState } from "react";
import { saveDefault,saveModes } from "./actions";
import type { ModeRow } from "@/server/inventory/modes";
const initial={ok:false,message:""};
const field="rounded-md border bg-background p-2";
export function DefaultEditor({mode}:{mode:string}) {
  const [result,action,pending]=useActionState(saveDefault,initial);
  return <form action={action} className="space-y-3 rounded-xl border p-4"><h2 className="text-xl">Default for new SKUs</h2><p className="text-sm">Existing SKUs keep their own settings.</p><select name="mode" defaultValue={mode} className={field}><option value="availability_only">Availability only</option><option value="counted">Count stock</option></select> <button disabled={pending} className={field}>Save default</button><p role="status">{result.message}</p></form>;
}
export function ModeEditor({rows,locations,canWrite}:{rows:ModeRow[];locations:{id:string;name:string}[];canWrite:boolean}) {
  const [result,action,pending]=useActionState(saveModes,initial);
  const [selected,setSelected]=useState<string[]>([]);
  const selectedCount=rows.filter(row=>selected.includes(row.id)).length;
  const allSelected=rows.length>0&&selectedCount===rows.length;
  function selectRow(id:string,checked:boolean) {
    setSelected(current=>checked?[...new Set([...current,id])]:current.filter(value=>value!==id));
  }
  return <form action={action} className="space-y-4"><fieldset disabled={pending||!canWrite} className="space-y-4"><legend className="sr-only">Stock counting and availability</legend>
    <div className="flex flex-wrap items-end gap-3 rounded-xl border p-4"><label>Mode for selected SKUs<select name="mode" className={`ml-2 ${field}`}><option value="">Keep current mode</option><option value="availability_only">Availability only</option><option value="counted">Count stock</option></select></label>
    <label>Sales availability<select name="available" className={`ml-2 ${field}`}><option value="">Keep current availability</option><option value="available">Available / allow sales</option><option value="unavailable">Not available / pause sales</option></select></label><button disabled={pending||selectedCount===0} className="rounded-md bg-primary p-2 text-primary-foreground disabled:opacity-50">Save selected SKUs</button></div>
    <p className="text-sm text-muted-foreground" role="status">{selectedCount} of {rows.length} SKUs on this page selected.</p>
    <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2"><label className="flex items-center gap-2"><input type="checkbox" checked={allSelected} disabled={rows.length===0} ref={element=>{if(element)element.indeterminate=selectedCount>0&&!allSelected;}} onChange={event=>setSelected(event.target.checked?rows.map(row=>row.id):[])} />Select all on this page</label></th><th className="p-2">Product / SKU</th><th className="p-2">Current mode</th><th className="p-2">Sales</th><th className="p-2">Physical counts (only when enabling counting)</th></tr></thead><tbody>{rows.map(row=><tr key={row.id} className="border-t"><td className="p-2"><input type="checkbox" name="variantId" value={row.id} checked={selected.includes(row.id)} onChange={event=>selectRow(row.id,event.target.checked)} aria-label={`Select ${row.sku}`}/></td><td className="p-2">{row.name}<br/>{row.sku}</td><td className="p-2">{row.mode==="counted"?"Count stock":"Availability only"}</td><td className="p-2">{row.available?"Sales enabled":"Not available"}</td><td className="p-2">{row.mode!=="counted" && locations.map(loc=><label key={loc.id} className="mr-3 inline-block">{loc.name}<input type="number" min="0" max="1000000" step="1" name={`count:${row.id}:${loc.id}`} aria-label={`${row.sku} physical count at ${loc.name}`} className={`ml-2 w-24 ${field}`}/></label>)}</td></tr>)}</tbody></table></div>
  </fieldset><p role="status" className={result.ok?"text-primary":"text-destructive"}>{result.message}</p></form>;
}
