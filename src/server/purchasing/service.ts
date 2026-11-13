import "server-only";
import { z } from "zod";
import { sql, type SQL } from "drizzle-orm";
import { getPermissionSession,type AuthSession } from "../auth/authorize";
import { catalogActor } from "../catalog/queries";
import { managementLock } from "../admin/queries";
import { getDb } from "../db";
import { purchasingInput,type PurchasingInput,type PurchasingResult,type PurchasingOptions } from "./contracts";
export function purchasingQuery(identity:AuthSession,requestId:string,input:PurchasingInput) {
 return sql`with actor as materialized (${catalogActor(identity,"inventory:write",true)}) select purchasing_execute(actor.id,${requestId}::uuid,${JSON.stringify(input)}::jsonb) as id from actor`;
}
export function createPurchasing(deps:{authorize:typeof getPermissionSession;write:(query:SQL)=>Promise<string|undefined>}) {
 return async(requestId:string,input:unknown):Promise<PurchasingResult>=>{
  const parsed=purchasingInput.safeParse(input);
  if(!parsed.success||!z.uuid().safeParse(requestId).success)return {ok:false,error:parsed.success?"Invalid request identifier.":parsed.error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; ")};
  try {
   const identity=await deps.authorize("inventory:write");if(!identity)return {ok:false,error:"Admin access is required."};
   const id=await deps.write(purchasingQuery(identity,requestId,parsed.data));
   return id?{ok:true,id}:{ok:false,error:"Your access changed. Refresh and sign in again."};
  }catch{return {ok:false,error:"Save not confirmed. Check for a duplicate name or SKU, inactive products, and valid locations. Check history before retrying; use the same request ID for an unchanged retry."};}
 };
}
export const savePurchasing=createPurchasing({authorize:getPermissionSession,write:async q=>{
 const db=getDb();const [,r]=await db.batch([db.execute(managementLock),db.execute<{id:string}>(q)]);return r.rows[0]?.id;
}});
export function purchasingOptionsQuery(identity:AuthSession) {
 return sql`with actor as materialized (${catalogActor(identity,"inventory:write")})
 select jsonb_build_object(
 'suppliers',coalesce((select jsonb_agg(s order by s.name) from suppliers s),'[]'),
 'locations',coalesce((select jsonb_agg(l order by l.name) from inventory_locations l),'[]'),
 'variants',coalesce((select jsonb_agg(x order by x.name,x.sku) from (select v.product_id as "productId",v.id,p.name,v.sku,v.inventory_mode as "inventoryMode" from product_variants v join products p on p.id=v.product_id where v.status='active' and p.status<>'archived' and v.currency='PHP') x),'[]'),
 'costs',coalesce((select jsonb_agg(x) from (select si.supplier_id as "supplierId",si.variant_id as "variantId",si.purchase_code as "purchaseCode",
 si.default_cost as "defaultCost",coalesce((select rl.unit_cost from stock_receipt_lines rl join stock_receipts r on r.id=rl.receipt_id where r.supplier_id=si.supplier_id and rl.variant_id=si.variant_id order by r.created_at desc,r.id desc limit 1),si.default_cost) as "unitCost" from supplier_items si) x),'[]')) as data where exists(select 1 from actor)`;
}
export async function purchasingOptions():Promise<PurchasingOptions> {
 const identity=await getPermissionSession("inventory:write");if(!identity)throw Error("Access denied");
 const r=await getDb().execute<{data:PurchasingOptions}>(purchasingOptionsQuery(identity));
 const data=r.rows[0]?.data;if(!data)throw Error("Access denied");return data;
}
export async function purchasingHistory() {
 const identity=await getPermissionSession("inventory:read");if(!identity)throw Error("Access denied");
 return (await getDb().execute<{id:string;supplier:string;location:string;deliveryDate:string;reference:string;total:string;lines:{name:string;sku:string;quantity:number;unitCost:number;counted:number}[]}>(sql`
 with actor as materialized (${catalogActor(identity,"inventory:read")})
 select r.id,s.name as supplier,loc.name as location,r.delivery_date::text as "deliveryDate",r.reference,
 sum(l.unit_cost::bigint*l.quantity)::text as total,jsonb_agg(jsonb_build_object('name',p.name,'sku',v.sku,'quantity',l.quantity,'unitCost',l.unit_cost,'counted',l.counted) order by p.name) as lines
 from stock_receipts r join suppliers s on s.id=r.supplier_id join inventory_locations loc on loc.id=r.location_id
 join stock_receipt_lines l on l.receipt_id=r.id join product_variants v on v.id=l.variant_id join products p on p.id=v.product_id
 where exists(select 1 from actor) group by r.id,s.name,loc.name order by r.created_at desc,r.id desc limit 100`)).rows;
}

export async function productsNeedingSetup(search:string) {
 const identity=await getPermissionSession("inventory:read");if(!identity)throw Error("Access denied");
 const pattern=`%${search.replace(/[\\%_]/g,"\\$&")}%`;
 return (await getDb().execute<{id:string;name:string}>(sql`with actor as materialized (${catalogActor(identity,"inventory:read")}) select p.id,p.name from products p where p.status<>'archived' and p.name ilike ${pattern} and not exists(select 1 from product_variants v where v.product_id=p.id) and exists(select 1 from actor) order by lower(p.name),p.id limit 100`)).rows;
}

export async function valuationHistory() {
 const identity=await getPermissionSession("inventory:write");if(!identity)throw Error("Access denied");
 return (await getDb().execute<{id:string;name:string;sku:string;location:string;beforeValue:string|null;afterValue:string;reason:string;createdAt:string}>(sql`with actor as materialized (${catalogActor(identity,"inventory:write")}) select x.id,p.name,v.sku,l.name as location,x.before_value::text as "beforeValue",x.after_value::text as "afterValue",x.reason,x.created_at::text as "createdAt" from stock_valuations x join product_variants v on v.id=x.variant_id join products p on p.id=v.product_id join inventory_locations l on l.id=x.location_id where exists(select 1 from actor) order by x.created_at desc,x.id desc limit 100`)).rows;
}
