"use client";
import { saveProductThumbnail } from "./image-actions";
import { maxProductImageSize,productImageTypes } from "@/server/catalog/image-contracts";
export async function uploadThumbnail(file:File,productId:string,altText:string,variantId:string|null=null) {
 if(!productImageTypes.some(t=>t===file.type)||file.size<=0||file.size>maxProductImageSize)throw Error("Choose a JPEG, PNG, WebP or AVIF image up to 5 MB.");
 const response=await fetch("/api/admin/products/images/upload",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({productId,variantId,contentType:file.type,size:file.size})});
 const details=await response.json() as {uploadUrl?:string;imageUrl?:string;error?:string};
 if(!response.ok||!details.uploadUrl||!details.imageUrl)throw Error(details.error||"Could not prepare the upload.");
 const stored=await fetch(details.uploadUrl,{method:"PUT",headers:{"Content-Type":file.type},body:file});
 if(!stored.ok)throw Error("Image upload failed. Please choose the file again.");
 const saved=await saveProductThumbnail({productId,variantId,imageUrl:details.imageUrl,altText:altText.trim()});
 if(!saved.ok)throw Error(saved.error);
}
