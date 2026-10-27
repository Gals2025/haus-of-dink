"use server";
import { revalidatePath } from "next/cache";
import { mutateCommerce } from "@/server/commerce/service";
export async function saveCommerce(requestId: string, input: unknown) {
  const result=await mutateCommerce(requestId,input);
  if(result.ok) {
    revalidatePath("/", "layout");
    for(const path of ["/admin/orders","/admin/customers","/admin/promotions","/admin/reports","/admin/settings","/admin/inventory"]) revalidatePath(path,"layout");
  }
  return result;
}
