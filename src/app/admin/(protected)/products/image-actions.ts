"use server";
import { revalidatePath } from "next/cache";
import { getPermissionSession } from "@/server/auth/authorize";
import { getDb } from "@/server/db";
import { managementLock } from "@/server/admin/queries";
import { maxProductImageSize, productImageInput, productImageTypes } from "@/server/catalog/image-contracts";
import { imageTargetQuery, saveProductImageQuery } from "@/server/catalog/image-queries";

export async function saveProductThumbnail(input: unknown): Promise<{ok:true}|{ok:false;error:string}> {
  const identity=await getPermissionSession("inventory:write");
  if (!identity) return {ok:false,error:"Product edit access is required."};
  const parsed=productImageInput.safeParse(input);
  if (!parsed.success) return {ok:false,error:parsed.error.issues[0]?.message??"Check the image details."};
  try {
    const db=getDb();
    if (!(await db.execute(imageTargetQuery(identity,parsed.data.productId,parsed.data.variantId))).rows.length) return {ok:false,error:"Product or SKU unavailable. Refresh and try again."};
    // Only the validated public Blob host and product-specific path may be checked.
    const uploaded=await fetch(parsed.data.imageUrl,{method:"HEAD",cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000)});
    const type=uploaded.headers.get("content-type")?.split(";")[0]?.trim();
    const size=Number(uploaded.headers.get("content-length"));
    if (!uploaded.ok || !productImageTypes.some(allowed=>allowed===type) || !Number.isSafeInteger(size) || size<=0 || size>maxProductImageSize) return {ok:false,error:"The uploaded image could not be verified. Choose the file again."};
    const [,result]=await db.batch([db.execute(managementLock),db.execute<{saved:boolean}>(saveProductImageQuery(identity,parsed.data))]);
    if (!result.rows[0]?.saved) return {ok:false,error:"Your access or the product changed. Refresh before retrying."};
  } catch { return {ok:false,error:"Could not save the thumbnail. Refresh and try again."}; }
  try { revalidatePath(`/admin/products/${parsed.data.productId}`);revalidatePath("/admin/pos");revalidatePath("/shop");revalidatePath("/"); } catch { /* The committed image is visible on the next request. */ }
  return {ok:true};
}
