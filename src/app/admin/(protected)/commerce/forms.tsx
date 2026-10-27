"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCommerce } from "./actions";
import { parsePesos, peso, type Customer, type Promotion, type Settings, type OrderDetail } from "@/server/commerce/contracts";
import type { OrderOptions } from "@/server/commerce/service";
export const control="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";
const button="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50";
function useSave() {
  const [pending,start]=useTransition(); const [message,setMessage]=useState(""); const router=useRouter();
  const request=useRef({body:"",id:""});
  return {pending,message,save:(input:unknown,navigate=false)=>start(async()=>{
    const body=JSON.stringify(input); if(request.current.body!==body) request.current={body,id:crypto.randomUUID()};
    setMessage("");
    try {
      const result=await saveCommerce(request.current.id,input);
      if(!result.ok) { setMessage(result.error);return; }
      setMessage("Saved successfully.");
      if(navigate) router.push(`/admin/orders/${result.id}`); else router.refresh();
    } catch {setMessage("Unable to confirm the result. Retry without changing the form to avoid a duplicate.");}
  })};
}
function Feedback({message}:{message:string}) {return message ? <p role="status" className="text-sm sm:col-span-2">{message}</p>:null;}
const value=(f:FormData,key:string)=>String(f.get(key)??"");
export function CustomerEditor({customer}:{customer?:Customer}) {
  const {pending,message,save}=useSave();
  return <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);save({action:"customer.save",...(customer?{id:customer.id}:{}),name:value(f,"name"),email:value(f,"email"),phone:value(f,"phone"),address:value(f,"address"),active:f.has("active")});}}>
    <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2"><legend className="mb-4 text-xl">{customer?"Edit customer":"New customer"}</legend>
      <label>Name<input required name="name" maxLength={160} defaultValue={customer?.name} className={control}/></label>
      <label>Email<input required name="email" type="email" maxLength={254} defaultValue={customer?.email} className={control}/></label>
      <label>Phone<input name="phone" type="tel" maxLength={40} defaultValue={customer?.phone} className={control}/></label>
      <label>Address<textarea name="address" maxLength={1000} defaultValue={customer?.address} className={control}/></label>
      <label className="flex items-center gap-2"><input name="active" type="checkbox" defaultChecked={customer?.active??true}/>Active (can place new orders)</label>
      <Feedback message={message}/><div className="sm:col-span-2"><button className={button}>{pending?"Saving…":"Save customer"}</button></div>
    </fieldset>
  </form>;
}
export function PromotionEditor({promotion:p}:{promotion?:Promotion}) {
  const {pending,message,save}=useSave(); const [kind,setKind]=useState(p?.kind??"percent");
  // Date-time fields are explicitly Philippine local time, independent of browser timezone.
  const local=(date?:string)=>date?new Date(new Date(date).getTime()+8*3600000).toISOString().slice(0,16):"";
  return <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);save({action:"promotion.save",...(p?{id:p.id}:{}),code:value(f,"code"),kind,amount:kind==="percent"?Number(value(f,"amount")):parsePesos(f.get("amount")),minimum:parsePesos(f.get("minimum")),startsAt:new Date(`${value(f,"startsAt")}:00+08:00`).toISOString(),endsAt:new Date(`${value(f,"endsAt")}:00+08:00`).toISOString(),usageLimit:Number(value(f,"usageLimit")),active:f.has("active")});}}>
    <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2"><legend className="mb-4 text-xl">{p?"Edit promotion":"New promotion"}</legend>
      <label>Code<input required name="code" maxLength={40} minLength={2} pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,39}" defaultValue={p?.code} className={control}/></label>
      <label>Discount type<select value={kind} onChange={e=>setKind(e.target.value as "fixed"|"percent")} className={control}><option value="percent">Percentage</option><option value="fixed">Fixed amount (PHP)</option></select></label>
      <label>{kind==="percent"?"Percent (1–100)":"Discount (PHP)"}<input key={kind} required name="amount" type="number" min={kind==="percent"?1:0.01} max={kind==="percent"?100:1000000} step={kind==="percent"?1:0.01} defaultValue={p?(kind==="percent"?p.amount:p.amount/100):undefined} className={control}/></label>
      <label>Minimum merchandise subtotal (PHP)<input required name="minimum" type="number" min="0" max="1000000" step="0.01" defaultValue={(p?.minimum??0)/100} className={control}/></label>
      <label>Starts (Philippine time)<input required name="startsAt" type="datetime-local" defaultValue={local(p?.startsAt)} className={control}/></label>
      <label>Ends (Philippine time)<input required name="endsAt" type="datetime-local" defaultValue={local(p?.endsAt)} className={control}/></label>
      <label>Usage limit (already used: {p?.used??0})<input required name="usageLimit" type="number" min={Math.max(1,p?.used??0)} max="1000000" step="1" defaultValue={p?.usageLimit??100} className={control}/></label>
      <label className="flex items-center gap-2"><input name="active" type="checkbox" defaultChecked={p?.active??true}/>Active</label>
      <Feedback message={message}/><div><button className={button}>{pending?"Saving…":"Save promotion"}</button></div>
    </fieldset>
  </form>;
}
export function SettingsEditor({settings:s,canWrite}:{settings:Settings;canWrite:boolean}) {
  const {pending,message,save}=useSave();
  return <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);save({action:"settings.save",name:value(f,"name"),email:value(f,"email"),phone:value(f,"phone"),address:value(f,"address"),shippingFee:parsePesos(f.get("shippingFee"))});}}>
    <fieldset disabled={pending||!canWrite} className="grid gap-4 sm:grid-cols-2">
      <label>Store name<input required name="name" maxLength={160} defaultValue={s.name} className={control}/></label>
      <label>Contact email<input required name="email" type="email" maxLength={254} defaultValue={s.email} className={control}/></label>
      <label>Phone<input name="phone" type="tel" maxLength={40} defaultValue={s.phone} className={control}/></label>
      <label>Business address<textarea name="address" maxLength={1000} defaultValue={s.address} className={control}/></label>
      <label>Shipping fee for new orders (PHP)<input required name="shippingFee" type="number" min="0" max="1000000" step="0.01" defaultValue={s.shippingFee/100} className={control}/></label>
      <p className="text-sm text-muted-foreground">Currency: PHP. Reporting timezone: Asia/Manila. Existing orders keep their original prices and shipping fee.</p>
      <Feedback message={message}/>{canWrite&&<div className="sm:col-span-2"><button className={button}>{pending?"Saving…":"Save settings"}</button></div>}
    </fieldset>
  </form>;
}
export function OrderComposer({options}:{options:OrderOptions}) {
  const {pending,message,save}=useSave(); const [lines,setLines]=useState([{key:0,variantId:"",quantity:1}]); const counter=useRef(1);
  const estimate=lines.reduce((sum,line)=>sum+(options.variants.find(v=>v.id===line.variantId)?.price??0)*line.quantity,0);
  return <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);save({action:"order.create",customerId:value(f,"customerId"),locationId:value(f,"locationId"),promotionCode:value(f,"promotionCode"),notes:value(f,"notes"),items:lines.map(({variantId,quantity})=>({variantId,quantity}))},true);}}>
    <fieldset disabled={pending} className="space-y-5"><legend className="mb-4 text-xl">Create order</legend>
      <div className="grid gap-4 sm:grid-cols-2"><label>Customer<select required name="customerId" className={control}><option value="">Choose customer</option>{options.customers.map(c=><option key={c.id} value={c.id}>{c.name} — {c.email}</option>)}</select></label>
      <label>Stock location<select required name="locationId" className={control}><option value="">Choose location</option>{options.locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label></div>
      {lines.map((line,index)=><div key={line.key} className="grid items-end gap-3 sm:grid-cols-[1fr_100px_auto]"><label>SKU {index+1}<select required value={line.variantId} onChange={e=>setLines(lines.map(l=>l.key===line.key?{...l,variantId:e.target.value}:l))} className={control}><option value="">Choose SKU</option>{options.variants.filter(v=>v.id===line.variantId||!lines.some(l=>l.variantId===v.id)).map(v=><option key={v.id} value={v.id}>{v.name} / {v.sku} — {peso(v.price)}</option>)}</select></label>
        <label>Quantity<input required type="number" min="1" max="1000000" step="1" value={line.quantity} onChange={e=>setLines(lines.map(l=>l.key===line.key?{...l,quantity:Number(e.target.value)}:l))} className={control}/></label>
        <button type="button" disabled={lines.length===1} onClick={()=>setLines(lines.filter(l=>l.key!==line.key))} className="p-2 underline">Remove</button></div>)}
      <button type="button" disabled={lines.length>=30} onClick={()=>setLines([...lines,{key:counter.current++,variantId:"",quantity:1}])} className="underline">Add SKU</button>
      <div className="grid gap-4 sm:grid-cols-2"><label>Promotion code (optional)<input name="promotionCode" maxLength={40} className={control}/></label><label>Order notes<textarea name="notes" maxLength={1000} className={control}/></label></div>
      <p>Merchandise subtotal: <strong>{peso(estimate)}</strong>. Final discount and shipping are calculated when saved.</p>
      <p className="text-sm text-muted-foreground">Saving reserves available stock. Record the received payment, then fulfill to deduct stock. Cancel unpaid orders to release their reservations.</p>
      <Feedback message={message}/><button className={button}>{pending?"Creating…":"Create order & reserve stock"}</button>
    </fieldset>
  </form>;
}
export function OrderControls({order}:{order:OrderDetail}) {
  const {pending,message,save}=useSave();
  return <div className="space-y-4"><p className="text-sm text-muted-foreground">Record only payments or refunds already completed outside this app. No funds are transferred here.</p>
    {order.status==="pending"&&<>
      {(order.paymentStatus==="unpaid"||order.paymentStatus==="paid")&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget); const refund=order.paymentStatus==="paid";if(!refund||window.confirm("Confirm the payment was refunded outside this app?")) save({action:refund?"order.refund":"order.pay",id:order.id,reference:value(f,"reference")});}} className="flex flex-wrap items-end gap-3">
        <label>Payment / refund reference<input required name="reference" minLength={3} maxLength={200} className={control}/></label><button disabled={pending} className={button}>{order.paymentStatus==="paid"?"Record completed refund":"Record received payment"}</button>
      </form>}
      <div className="flex flex-wrap gap-4">{order.paymentStatus==="paid"&&<button disabled={pending} onClick={()=>{if(window.confirm("Fulfill this order and deduct reserved stock?"))save({action:"order.fulfill",id:order.id});}} className={button}>Fulfill order</button>}
      {order.paymentStatus!=="paid"&&<button disabled={pending} onClick={()=>{if(window.confirm("Cancel this order and release reserved stock?"))save({action:"order.cancel",id:order.id});}} className="rounded-md border px-4 py-2">Cancel order</button>}</div>
    </>}
    <Feedback message={message}/>
  </div>;
}
