"use server";
import { revalidatePath } from "next/cache";
import { configureInventory, saveInventoryDefault } from "@/server/inventory/modes";
type Result = { message: string; ok: boolean };
export async function saveModes(_previous: Result, form: FormData): Promise<Result> {
  try {
    const ids = form.getAll("variantId").map(String);
    const mode = String(form.get("mode") ?? "");
    const available = String(form.get("available") ?? "");
    const changes = ids.map(variantId => {
      const counts = Object.fromEntries([...form.entries()].filter(([key,value]) => key.startsWith(`count:${variantId}:`) && String(value).trim()!=="").map(([key,value])=>[key.split(":")[2],Number(value)]));
      return {variantId,...(mode?{mode}:{}),...(available?{available:available==="available"}:{}),counts};
    });
    await configureInventory(changes);
    revalidatePath("/admin/inventory"); revalidatePath("/admin/inventory/modes"); revalidatePath("/shop"); revalidatePath("/admin/pos");
    return {ok:true,message:`Updated ${ids.length} SKU(s).`};
  } catch {
    return {ok:false,message:"Unable to save. Select at least one SKU. Finish or cancel its open orders and reservations before changing mode, and enter physical counts at every location when enabling counting. No selected changes were applied."};
  }
}
export async function saveDefault(_previous: Result, form: FormData): Promise<Result> {
  try { await saveInventoryDefault(form.get("mode")); revalidatePath("/admin/inventory/modes"); return {ok:true,message:"Default saved. Existing SKUs were not changed."}; }
  catch { return {ok:false,message:"Unable to save the default. Only a super administrator can change it."}; }
}
