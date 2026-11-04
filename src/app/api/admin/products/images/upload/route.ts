import { issueSignedToken, parseStoreIdFromDelegationToken, presignUrl } from "@vercel/blob";
import { getPermissionSession } from "@/server/auth/authorize";
import { getDb } from "@/server/db";
import { productImageUpload } from "@/server/catalog/image-contracts";
import { imageTargetQuery } from "@/server/catalog/image-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const extensions = { "image/jpeg":"jpg", "image/png":"png", "image/webp":"webp", "image/avif":"avif" } as const;
const headers = { "Cache-Control":"no-store" };
export async function POST(request: Request) {
  const identity = await getPermissionSession("inventory:write");
  if (!identity) return Response.json({error:"Product edit access is required."},{status:403,headers});
  try {
    const parsed=productImageUpload.safeParse(await request.json());
    if (!parsed.success) return Response.json({error:"Choose a JPEG, PNG, WebP or AVIF image up to 5 MB and a valid product."},{status:400,headers});
    const input=parsed.data;
    const target=await getDb().execute(imageTargetQuery(identity,input.productId,input.variantId));
    if (!target.rows.length) return Response.json({error:"Product or SKU unavailable. Refresh before uploading."},{status:403,headers});
    // Reuse the existing public image store, never the private payment-proof store.
    const storeId=process.env.FEATURED_BLOB_STORE_ID;
    if (!storeId) return Response.json({error:"Public image storage is not connected. Connect the existing featured-image Blob store to this deployment."},{status:503,headers});
    const pathname=`product-images/${input.productId}/${crypto.randomUUID()}.${extensions[input.contentType]}`;
    const validUntil=Date.now()+5*60*1000;
    const token=await issueSignedToken({storeId,pathname,operations:["put"],validUntil,allowedContentTypes:[input.contentType],maximumSizeInBytes:input.size});
    const {presignedUrl}=await presignUrl(token,{operation:"put",pathname,access:"public",validUntil,allowedContentTypes:[input.contentType],maximumSizeInBytes:input.size,addRandomSuffix:false});
    const publicId=parseStoreIdFromDelegationToken(token.delegationToken);
    if (!publicId) throw new Error("Image storage unavailable");
    return Response.json({uploadUrl:presignedUrl,imageUrl:`https://${publicId}.public.blob.vercel-storage.com/${pathname}`},{headers});
  } catch {
    return Response.json({error:"Could not prepare the upload. Check the public Blob store connection and try again."},{status:503,headers});
  }
}
