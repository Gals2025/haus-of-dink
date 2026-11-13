"use client";
import { useState,useTransition } from "react";
import { savePurchase } from "../inventory/receiving/actions";
import type { PurchasingOptions } from "@/server/purchasing/contracts";
export function SupplierCreator({onCreated}:{onCreated:(supplier:PurchasingOptions["suppliers"][number])=>void}) {
 const [name,setName]=useState(""),[contact,setContact]=useState(""),[message,setMessage]=useState(""),[pending,start]=useTransition();
 return <details className="my-3 rounded border p-3"><summary>Add a supplier</summary><div className="mt-3 space-y-3"><label className="block text-sm">New supplier name<input value={name} maxLength={160} onChange={e=>setName(e.target.value)} className="mt-1 block w-full rounded border bg-background p-2"/></label><label className="block text-sm">Supplier contact (optional)<input value={contact} maxLength={500} onChange={e=>setContact(e.target.value)} className="mt-1 block w-full rounded border bg-background p-2"/></label><button type="button" disabled={pending||!name.trim()} className="rounded border px-3 py-2 disabled:opacity-50" onClick={()=>start(async()=>{const result=await savePurchase(crypto.randomUUID(),{action:"supplier.create",name,contact});if(!result.ok){setMessage(result.error);return;}onCreated({id:result.id,name:name.trim(),contact:contact.trim()});setName("");setContact("");setMessage("Supplier created and selected for this product.");})}>{pending?"Adding…":"Add supplier"}</button>{message&&<p role="status" className="text-sm">{message}</p>}</div></details>;
}
