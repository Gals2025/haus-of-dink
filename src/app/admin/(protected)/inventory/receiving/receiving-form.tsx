"use client";
import { useState,useTransition } from "react";
import Link from "next/link";
import { phpCents,type PurchasingOptions } from "@/server/purchasing/contracts";
import type { ProductOptions } from "@/server/catalog/service";
import { ProductForm } from "../../products/product-form";
import { savePurchase,refreshPurchaseOptions } from "./actions";
import { parseCsv } from "@/lib/data-transfer/csv";
const control="mt-1 w-full rounded-md border bg-background p-2";
type Line={key:string;variantId:string;quantity:string;cost:string};
const blank=():Line=>({key:crypto.randomUUID(),variantId:"",quantity:"1",cost:""});
export function ReceivingForm({options,productOptions,initialVariant="",initialLocation=""}:{options:PurchasingOptions;productOptions:ProductOptions;initialVariant?:string;initialLocation?:string}) {
 const [data,setData]=useState(options),[supplier,setSupplier]=useState(""),[location,setLocation]=useState(options.locations.some(l=>l.id===initialLocation)?initialLocation:options.locations[0]?.id??"");
 const [date,setDate]=useState(()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()));
 const [reference,setReference]=useState(""),[lines,setLines]=useState<Line[]>(()=>[{...blank(),variantId:initialVariant}]);
 const [supplierName,setSupplierName]=useState(""),[contact,setContact]=useState(""),[quick,setQuick]=useState(false);
 const [message,setMessage]=useState(""),[request,setRequest]=useState(()=>crypto.randomUUID()),[pending,start]=useTransition();
 const [review,setReview]=useState(false),[posted,setPosted]=useState(false);
 function defaultCost(supplierId:string,variantId:string){const c=data.costs.find(c=>c.supplierId===supplierId&&c.variantId===variantId)?.unitCost;return c==null?"":(c/100).toFixed(2);}
 function edit(key:string,patch:Partial<Line>){setLines(old=>old.map(l=>l.key===key?{...l,...patch}:l));setReview(false);}
 const total=lines.reduce((s,l)=>s+(phpCents(l.cost)??0)*Number(l.quantity),0);
 async function importFile(file:File){
  try{
   if(file.size>500000)throw Error("Choose a file no larger than 500 KB.");
   const text=/\.xlsx?$/i.test(file.name)?(await import("@/lib/data-transfer/spreadsheet")).spreadsheetToCsv(await file.arrayBuffer()):await file.text();
   const rows=parseCsv(text);const header=rows.shift()?.map(h=>h.replace(/^\uFEFF/,"").trim().toLowerCase());
   if(header?.join(",")!=="sku,quantity,unit_cost_php")throw Error("Use headers: sku,quantity,unit_cost_php");
   const next=rows.filter(r=>r.some(Boolean)).map((r,i)=>{
    const variant=data.variants.find(v=>v.sku.toLowerCase()===r[0]?.trim().toLowerCase());
    const cost=(r[2]??"").replaceAll(",","").trim();const qty=(r[1]??"").trim();
    if(r.length!==3||!variant||!/^\d+$/.test(qty)||Number(qty)<1||Number(qty)>1000000||phpCents(cost)===null)throw Error(`Row ${i+2}: use an existing SKU, positive whole quantity and PHP unit cost.`);
    return {key:crypto.randomUUID(),variantId:variant.id,quantity:qty,cost};
   });
   if(!next.length||next.length>100||new Set(next.map(l=>l.variantId)).size!==next.length)throw Error("Use 1–100 unique SKUs.");
   setLines(next);setReview(false);setMessage("Imported lines are ready for review. Select supplier and location before posting.");
  }catch(e){setMessage(e instanceof Error?e.message:"Could not read file.");}
 }
 function validate(){
  if(!supplier||!location||!date||lines.some(l=>!l.variantId||!/^\d+$/.test(l.quantity)||Number(l.quantity)<1||Number(l.quantity)>1000000||phpCents(l.cost)===null)||new Set(lines.map(l=>l.variantId)).size!==lines.length){setMessage("Select supplier, location, unique products, whole quantities (1–1,000,000) and PHP costs with up to two decimals.");return false;}return true;
 }
 return <div className="space-y-5">
 <p className="text-sm">Record a delivery from one supplier to one location. Actual costs never change selling prices. Availability-only lines record purchases without changing stock or sales availability.</p>
 {!posted&&<fieldset disabled={pending} className="space-y-4">
 <div className="grid gap-4 sm:grid-cols-2"><label>Supplier<select required className={control} value={supplier} onChange={e=>{setSupplier(e.target.value);setLines(old=>old.map(l=>({...l,cost:defaultCost(e.target.value,l.variantId)})));setReview(false);}}><option value="">Choose supplier</option>{data.suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
 <label>Store location<select className={control} value={location} onChange={e=>{setLocation(e.target.value);setReview(false);}}>{data.locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
 <label>Delivery date<input type="date" required className={control} value={date} onChange={e=>{setDate(e.target.value);setReview(false);}}/></label>
 <label>Delivery / invoice reference (optional)<input className={control} maxLength={200} value={reference} onChange={e=>{setReference(e.target.value);setReview(false);}}/></label></div>
 <details className="rounded border p-3"><summary>Add supplier</summary><div className="mt-3 grid gap-2 sm:grid-cols-2"><label>Supplier name<input value={supplierName} maxLength={160} onChange={e=>setSupplierName(e.target.value)} className={control}/></label><label>Contact details (optional)<input value={contact} maxLength={500} onChange={e=>setContact(e.target.value)} className={control}/></label></div><button type="button" className="mt-3 rounded border px-3 py-2" onClick={()=>start(async()=>{const r=await savePurchase(crypto.randomUUID(),{action:"supplier.create",name:supplierName,contact});if(!r.ok){setMessage(r.error);return;}setData(await refreshPurchaseOptions());setSupplier(r.id);setSupplierName("");setContact("");setMessage("Supplier added. Your delivery lines are preserved.");setReview(false);})}>Save supplier</button></details>
 <div className="flex flex-wrap gap-3"><button type="button" className="underline" onClick={()=>setQuick(!quick)}>{quick?"Close new product":"Quick add product"}</button><a download="supplier-receipt-template.csv" href="data:text/csv;charset=utf-8,sku%2Cquantity%2Cunit_cost_php%0A" className="underline">Download receipt template</a><label className="underline">Import CSV / XLS / XLSX<input className="block" type="file" accept=".csv,.xls,.xlsx" onChange={e=>{const f=e.target.files?.[0];if(f)void importFile(f);e.target.value="";}}/></label></div>
 {lines.map((l,index)=><div key={l.key} className="grid items-end gap-3 rounded border p-3 sm:grid-cols-[2fr_1fr_1fr_auto]"><label>Product {index+1}<select className={control} value={l.variantId} onChange={e=>edit(l.key,{variantId:e.target.value,cost:defaultCost(supplier,e.target.value)})}><option value="">Choose product / SKU</option>{data.variants.map(v=><option key={v.id} value={v.id}>{v.name} · {v.sku}{v.inventoryMode==="availability_only"?" (not counted)":""}</option>)}</select></label><label>Quantity<input inputMode="numeric" className={control} value={l.quantity} onChange={e=>edit(l.key,{quantity:e.target.value})}/></label><label>Unit cost (PHP)<input inputMode="decimal" className={control} value={l.cost} onChange={e=>edit(l.key,{cost:e.target.value})}/></label><button type="button" disabled={lines.length===1} className="p-2 underline disabled:opacity-50" onClick={()=>{setLines(old=>old.filter(x=>x.key!==l.key));setReview(false);}}>Remove</button></div>)}
 <button type="button" disabled={lines.length>=100} className="rounded border px-4 py-2" onClick={()=>{setLines(old=>[...old,blank()]);setReview(false);}}>Add another product</button>
 <p className="text-xl">Delivery total: ₱{(total/100).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2})}</p>
 <button type="button" className="rounded border px-4 py-2" onClick={()=>{if(validate()){setReview(true);setMessage("");}}}>Review delivery</button>
 {review&&<div className="space-y-3 rounded border p-4"><p>{data.suppliers.find(s=>s.id===supplier)?.name} → {data.locations.find(l=>l.id===location)?.name} · {date}</p><p>{lines.length} product(s). Posting saves all lines together. Posted receipts cannot be edited.</p><button type="button" className="rounded bg-primary px-4 py-3 text-primary-foreground" onClick={()=>{if(!validate())return;start(async()=>{try{const r=await savePurchase(request,{action:"receipt.post",supplierId:supplier,locationId:location,deliveryDate:date,reference,lines:lines.map(l=>({variantId:l.variantId,quantity:Number(l.quantity),unitCost:phpCents(l.cost)}))});if(!r.ok){setMessage(r.error);return;}setPosted(true);setMessage(`Delivery posted. Receipt ${r.id}`);try{setData(await refreshPurchaseOptions());}catch{/* Receipt is saved; reload for fresh cost suggestions. */}}catch{setMessage("Receipt not confirmed. Check posted deliveries before retrying. Keep this receipt unchanged for a safe retry.");}});}}>Confirm receipt</button></div>}
 </fieldset>}
 {quick&&!posted&&<section className="rounded border p-4"><h2 className="mb-4 text-2xl">New product</h2><ProductForm options={productOptions} suppliers={data.suppliers} onCreated={async(id,warning)=>{const next=await refreshPurchaseOptions();setData(next);const v=next.variants.find(v=>v.productId===id);if(v)setLines(old=>{const empty=old.find(l=>!l.variantId);return empty?old.map(l=>l.key===empty.key?{...l,variantId:v.id}:l):old.length<100?[...old,{...blank(),variantId:v.id}]:old;});setQuick(false);setReview(false);setMessage(warning??"Product created. Check quantity and actual cost before posting.");}}/></section>}
 {message&&<p role="status" className="rounded border p-3">{message}</p>}
 {posted&&<div className="flex gap-4"><Link className="underline" href="/admin/inventory">View inventory</Link><button className="underline" onClick={()=>{setLines([blank()]);setRequest(crypto.randomUUID());setPosted(false);setReview(false);setMessage("");}}>Receive another delivery</button></div>}
 </div>;
}
