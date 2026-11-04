"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveProductThumbnail } from "./image-actions";
import { maxProductImageSize,productImageTypes } from "@/server/catalog/image-contracts";

export function ProductImageUploader({productId,name,variants}:{productId:string;name:string;variants:{id:string;sku:string}[]}) {
  const [variantId,setVariantId]=useState("");
  const [altText,setAltText]=useState(name);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const router=useRouter();
  async function upload(file:File) {
    setMessage("");
    if (!productImageTypes.some(type=>type===file.type) || file.size<=0 || file.size>maxProductImageSize) {setMessage("Choose a JPEG, PNG, WebP or AVIF image up to 5 MB.");return;}
    if (!altText.trim()) {setMessage("Add a short image description before uploading.");return;}
    setBusy(true);
    try {
      const response=await fetch("/api/admin/products/images/upload",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({productId,variantId:variantId||null,contentType:file.type,size:file.size})});
      const details=await response.json() as {uploadUrl?:string;imageUrl?:string;error?:string};
      if (!response.ok||!details.uploadUrl||!details.imageUrl) throw new Error(details.error||"Could not prepare the upload.");
      const stored=await fetch(details.uploadUrl,{method:"PUT",headers:{"Content-Type":file.type},body:file});
      if (!stored.ok) throw new Error("The image upload failed. Please choose the file again.");
      const saved=await saveProductThumbnail({productId,variantId:variantId||null,imageUrl:details.imageUrl,altText:altText.trim()});
      if (!saved.ok) throw new Error(saved.error);
      setMessage("Thumbnail saved. The POS and storefront will use it; previous images remain in the gallery.");router.refresh();
    } catch(error) {setMessage(error instanceof Error?error.message:"Could not upload the image.");}
    finally {setBusy(false);}
  }
  return <div className="space-y-3 rounded-xl border bg-card p-4"><h3 className="font-medium">Upload thumbnail</h3><fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
    <label className="text-sm">Use image for<select value={variantId} onChange={event=>setVariantId(event.target.value)} className="mt-1 block w-full rounded-md border bg-background p-2"><option value="">Product (all SKUs without their own image)</option>{variants.map(v=><option key={v.id} value={v.id}>{v.sku}</option>)}</select></label>
    <label className="text-sm">Image description<input value={altText} maxLength={500} onChange={event=>setAltText(event.target.value)} className="mt-1 block w-full rounded-md border bg-background p-2"/></label>
    <label className="text-sm sm:col-span-2">Choose thumbnail<input type="file" accept={productImageTypes.join(",")} className="mt-2 block w-full" onChange={event=>{const file=event.target.files?.[0];event.currentTarget.value="";if(file)void upload(file);}}/></label>
  </fieldset><p className="text-xs text-muted-foreground">JPEG, PNG, WebP or AVIF, up to 5 MB. Uploading makes this the primary image for the selected product or SKU.</p><p role="status" className="text-sm">{busy?"Uploading thumbnail…":message}</p></div>;
}
