"use client";
import { useActionState,useState } from "react";
import { useRouter } from "next/navigation";
import { createLocation } from "./actions";
export function LocationForm() {
 const [name,setName]=useState("");
 const router=useRouter();
 const [result,action,pending]=useActionState(async(_previous:{ok:boolean;message:string},form:FormData)=>{
   try {
     const response=await createLocation(form);
     if(response.ok){setName("");router.refresh();}
     return response;
   } catch {return {ok:false,message:"The result could not be confirmed. Refresh the location list before trying again."};}
 },{ok:false,message:""});
 return <form action={action} className="space-y-4 rounded-xl border bg-card p-5">
   <h2 className="text-xl">Add a store location</h2>
   <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm">Location name<input name="name" value={name} onChange={event=>setName(event.target.value)} required maxLength={160} disabled={pending} placeholder="e.g. Branch 2 or Warehouse" className="mt-1 block min-h-11 w-full rounded-md border bg-background px-3 py-2"/></label>
   <button disabled={pending||!name.trim()} className="min-h-11 rounded-md bg-primary px-5 py-2 text-primary-foreground disabled:opacity-50">{pending?"Adding…":"Add location"}</button></div>
   {result.message&&<p role={result.ok?"status":"alert"} className={result.ok?"text-sm text-primary":"text-sm text-destructive"}>{result.message}</p>}
 </form>;
}
