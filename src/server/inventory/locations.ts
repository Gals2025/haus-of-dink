import "server-only";
import { sql,type SQL } from "drizzle-orm";
import { z } from "zod";
import { getPermissionSession,type AuthSession } from "../auth/authorize";
import { catalogActor } from "../catalog/queries";
import { managementLock } from "../admin/queries";
import { getDb } from "../db";

export const locationInput=z.strictObject({name:z.string().trim().min(1).max(160)});
export type StoreLocation={id:string;name:string};
export type LocationOutcome={authorized:boolean;duplicate:boolean;id:string|null;name:string|null;audited:boolean};
export type LocationResult={ok:true;location:StoreLocation}|{ok:false;error:string};
export function listStoreLocationsQuery(identity:AuthSession) {
 return sql`with actor as materialized (${catalogActor(identity,"inventory:read")})
   select id,name from inventory_locations where exists(select 1 from actor) order by lower(name),id`;
}
export function createStoreLocationQuery(identity:AuthSession,name:string) {
 return sql`with actor as materialized (${catalogActor(identity,"inventory:write",true)}),
   existing as materialized (select id from inventory_locations where lower(trim(name))=lower(${name}) limit 1),
   added as (insert into inventory_locations(name) select ${name} from actor where not exists(select 1 from existing)
     on conflict(name) do nothing returning id,name),
   logged as (insert into commerce_audit(request_id,actor_id,entity_id,action,payload)
     select gen_random_uuid(),actor.id,added.id,'inventory.location.create',jsonb_build_object('name',added.name)
     from actor cross join added returning entity_id)
   select exists(select 1 from actor) as authorized,exists(select 1 from existing) as duplicate,
     (select id from added) as id,(select name from added) as name,exists(select 1 from logged) as audited`;
}
export function createLocationService(deps:{authorize:typeof getPermissionSession;change:(query:SQL)=>Promise<LocationOutcome|undefined>}) {
 return async(input:unknown):Promise<LocationResult>=>{
   const parsed=locationInput.safeParse(input);
   if(!parsed.success)return {ok:false,error:"Enter a location name between 1 and 160 characters."};
   try {
     const identity=await deps.authorize("inventory:write");
     if(!identity)return {ok:false,error:"Admin access is required to add store locations."};
     const result=await deps.change(createStoreLocationQuery(identity,parsed.data.name));
     if(!result?.authorized)return {ok:false,error:"Your access changed. Refresh and sign in again."};
     if(result.duplicate)return {ok:false,error:"A store location with that name already exists."};
     if(!result.id||!result.name||!result.audited)return {ok:false,error:"The location could not be added. Refresh the list before trying again."};
     return {ok:true,location:{id:result.id,name:result.name}};
   } catch {return {ok:false,error:"The location could not be added. Refresh the list before trying again."};}
 };
}
export const addStoreLocation=createLocationService({
 authorize:getPermissionSession,
 change:async query=>{
   const db=getDb();
   const [,result]=await db.batch([db.execute(managementLock),db.execute<LocationOutcome>(query)]);
   return result.rows[0];
 },
});
export async function listStoreLocations() {
 const identity=await getPermissionSession("inventory:read");
 if(!identity)throw new Error("Access denied.");
 return (await getDb().execute<StoreLocation>(listStoreLocationsQuery(identity))).rows;
}
