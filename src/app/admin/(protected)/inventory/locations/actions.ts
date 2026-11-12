"use server";
import { revalidatePath } from "next/cache";
import { addStoreLocation } from "@/server/inventory/locations";
export async function createLocation(form:FormData):Promise<{ok:boolean;message:string}> {
 const result=await addStoreLocation({name:form.get("name")});
 if(!result.ok)return {ok:false,message:result.error};
 try {
   for(const path of ["/admin/inventory/locations","/admin/inventory","/admin/inventory/modes","/admin/inventory/movements","/admin/inventory/adjustments","/admin/pos"])revalidatePath(path);
 } catch { /* The location is committed; do not report a failed creation. */ }
 return {ok:true,message:`${result.location.name} was added. It is now available in the Inventory and POS location lists.`};
}
