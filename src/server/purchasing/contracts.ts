import { z } from "zod";
import { createProductInput } from "../catalog/contracts";
const cost=z.number().int().min(0).max(2147483647);
const item=z.strictObject({supplierId:z.uuid(),purchaseCode:z.string().trim().max(100).default(""),defaultCost:cost.nullable().default(null)});
export const purchasingInput=z.discriminatedUnion("action",[
 z.strictObject({action:z.literal("supplier.create"),name:z.string().trim().min(1).max(160),contact:z.string().trim().max(500).default("")}),
 z.strictObject({action:z.literal("supplier.item"),variantId:z.uuid(),...item.shape}),
 createProductInput.extend({action:z.literal("product.create"),price:cost,sku:z.string().trim().max(100).default(""),inventoryMode:z.enum(["default","counted","availability_only"]).default("default"),suppliers:z.array(item).max(50).default([])}),
 z.strictObject({action:z.literal("receipt.post"),supplierId:z.uuid(),locationId:z.uuid(),deliveryDate:z.iso.date(),reference:z.string().trim().max(200),
 lines:z.array(z.strictObject({variantId:z.uuid(),quantity:z.number().int().min(1).max(1000000),unitCost:cost})).min(1).max(100).refine(rows=>new Set(rows.map(r=>r.variantId)).size===rows.length,"Use one line per SKU").refine(rows=>rows.reduce((s,r)=>s+BigInt(r.unitCost)*BigInt(r.quantity),BigInt(0))<=BigInt(Number.MAX_SAFE_INTEGER),"Receipt total is too large")}),
 z.strictObject({action:z.literal("valuation.set"),variantId:z.uuid(),locationId:z.uuid(),value:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),reason:z.string().trim().min(3).max(500)}),
]);
export type PurchasingInput=z.infer<typeof purchasingInput>;
export type PurchasingResult={ok:true;id:string}|{ok:false;error:string};
export type PurchasingOptions={suppliers:{id:string;name:string;contact:string}[];locations:{id:string;name:string}[];
 variants:{productId:string;id:string;name:string;sku:string;inventoryMode:string}[];
 costs:{supplierId:string;variantId:string;unitCost:number|null;defaultCost:number|null;purchaseCode:string}[]};
// PHP input is parsed exactly, without floating point multiplication or rounding.
export function phpCents(value:string):number|null {
 const s=value.trim();if(!/^\d{1,8}(\.\d{1,2})?$/.test(s))return null;
 const [whole,fraction=""]=s.split(".");const n=Number(whole)*100+Number(fraction.padEnd(2,"0"));
 return n<=2147483647?n:null;
}
