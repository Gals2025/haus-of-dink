"use server";
import { revalidatePath } from "next/cache";
import { savePurchasing,purchasingOptions } from "@/server/purchasing/service";
export async function savePurchase(requestId:string,input:unknown) {
 const result=await savePurchasing(requestId,input);
 if(result.ok) {try {revalidatePath("/admin/inventory");revalidatePath("/admin/products");revalidatePath("/admin/inventory/receiving");revalidatePath("/admin/inventory/suppliers");}catch{/* Write already confirmed. */}}
 return result;
}
export async function refreshPurchaseOptions(){return purchasingOptions();}
