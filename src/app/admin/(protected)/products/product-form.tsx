"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { createProductInput, normalizeSlug, type ProductInput, type Product } from "@/server/catalog/contracts";
import { changedProductFields } from "@/server/catalog/admin-input";
import type { ProductOptions } from "@/server/catalog/service";
import { updateCatalogProduct } from "./actions";

import { savePurchase } from "../inventory/receiving/actions";
import { phpCents, type PurchasingOptions } from "@/server/purchasing/contracts";
import { uploadThumbnail } from "./upload-thumbnail";
import { maxProductImageSize,productImageTypes } from "@/server/catalog/image-contracts";
import { SupplierCreator } from "./supplier-creator";
import { OptionCreator } from "./option-creator";

const control = "mt-1 block w-full rounded-md border bg-background p-3 disabled:opacity-60";
export function ProductForm({ product, options, suppliers: initialSuppliers = [], onCreated }: { product?: Product; options: ProductOptions; suppliers?: PurchasingOptions["suppliers"]; onCreated?: (id:string,warning?:string)=>void }) {
  const router = useRouter();
  const [addedSuppliers,setAddedSuppliers]=useState<PurchasingOptions["suppliers"]>([]);
  const suppliers=[...initialSuppliers,...addedSuppliers.filter(s=>!initialSuppliers.some(i=>i.id===s.id))];
  const [thumbnail,setThumbnail]=useState<File|null>(null);
  const [createdId,setCreatedId]=useState("");
  const [price,setPrice]=useState("");
  const [sku,setSku]=useState("");
  const [mode,setMode]=useState("default");
  const [selectedSuppliers,setSelectedSuppliers]=useState<Record<string,{purchaseCode:string;cost:string}>>({});
  const [requestId]=useState(()=>crypto.randomUUID());

  const initial: ProductInput = product ? {
    name: product.name, slug: product.slug, description: product.description, shortDescription: product.shortDescription,
    brandId: product.brandId, categoryId: product.categoryId, status: product.status, featured: product.featured, newArrival: product.newArrival,
  } : { name: "", slug: "", description: null, shortDescription: null, brandId: "", categoryId: "", status: "draft", featured: false, newArrival: false };
  const [addedBrands, setAddedBrands] = useState<ProductOptions["brands"]>([]);
  const [addedCategories, setAddedCategories] = useState<ProductOptions["categories"]>([]);
  const brands = [...options.brands, ...addedBrands.filter((b) => !options.brands.some((o) => o.id === b.id))].sort((a, b) => a.name.localeCompare(b.name));
  const categories = [...options.categories, ...addedCategories.filter((c) => !options.categories.some((o) => o.id === c.id))].sort((a, b) => a.name.localeCompare(b.name));
  const [values, setValues] = useState(initial);
  const [slugEdited, setSlugEdited] = useState(Boolean(product));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  function set<K extends keyof ProductInput>(key: K, value: ProductInput[K]) { setValues((old) => ({ ...old, [key]: value })); }
  function error(key: string) { return fieldErrors[key] ? <span id={`${key}-error`} className="mt-1 block text-sm text-destructive">{fieldErrors[key]}</span> : null; }
  function accessibility(key: string) { return { "aria-invalid": Boolean(fieldErrors[key]), "aria-describedby": fieldErrors[key] ? `${key}-error` : undefined }; }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending || saved) return;
    const receive=(event.nativeEvent as SubmitEvent).submitter?.getAttribute("name")==="receive";
    const parsed = createProductInput.safeParse(values);
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      setMessage("Check the highlighted fields."); return;
    }
    if(!product&&phpCents(price)===null){setMessage("Enter a PHP selling price with up to two decimal places.");return;}
    if(Object.values(selectedSuppliers).some(s=>s.cost!==""&&phpCents(s.cost)===null)){setMessage("Enter supplier costs in PHP with up to two decimal places.");return;}
    setFieldErrors({}); setMessage("");
    startTransition(async () => {
      try {
        const result = product ? await updateCatalogProduct(product.id, changedProductFields(initial, parsed.data)) : await savePurchase(requestId,{...parsed.data,action:"product.create",price:phpCents(price),sku,inventoryMode:mode,suppliers:Object.entries(selectedSuppliers).map(([supplierId,v])=>({supplierId,purchaseCode:v.purchaseCode,defaultCost:v.cost===""?null:phpCents(v.cost)}))});
        if (!result.ok) { setMessage(result.error); return; }
        setSaved(true);
        const id="productId" in result?result.productId:result.id;
        setCreatedId(id);
        if(thumbnail){try{await uploadThumbnail(thumbnail,id,parsed.data.name);}catch{const warning="Product saved, but the thumbnail upload failed. Open product details to retry the image upload.";setMessage(warning);if(onCreated)await onCreated(id,warning);return;}}
        if(onCreated){await onCreated(id);return;}
        router.push(receive?`/admin/inventory/receiving?productId=${id}`:`/admin/products/${id}?saved=${product ? "updated" : "created"}`);
        router.refresh();
      } catch { setMessage("Save not confirmed. Refresh and check the product before retrying."); }
    });
  }
  const missingOptions = !brands.length || !categories.length;
  return <form onSubmit={submit} className="max-w-3xl space-y-6 rounded-xl border bg-card p-5 sm:p-8">
    {missingOptions && <p role="alert" className="text-sm text-destructive">A brand and category must exist before a product can be saved.</p>}
    <fieldset disabled={pending || saved} className="space-y-5 disabled:opacity-70">
      <legend className="sr-only">Product information</legend>
      <label className="block text-sm">Product name<input name="name" required maxLength={240} value={values.name} {...accessibility("name")} className={control}
        onChange={(e) => { const name = e.target.value; setValues((old) => ({ ...old, name, ...(!slugEdited ? { slug: normalizeSlug(name) } : {}) })); }} />{error("name")}</label>
      <label className="block text-sm">Slug<input name="slug" required maxLength={260} value={values.slug} {...accessibility("slug")} className={control}
        onChange={(e) => { setSlugEdited(true); set("slug", e.target.value); }} onBlur={() => set("slug", normalizeSlug(values.slug))} />
        <span className="mt-1 block text-xs text-muted-foreground">Lowercase words separated by hyphens. Slugs must be unique.</span>{error("slug")}</label>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2"><label className="text-sm">Brand<select name="brandId" required value={values.brandId} onChange={(e) => set("brandId", e.target.value)} {...accessibility("brandId")} className={control}>
          <option value="">Select brand</option>{brands.map((b) => <option key={b.id} value={b.id} disabled={b.status !== "active" && b.id !== product?.brandId}>{b.name}{b.status !== "active" ? " (inactive)" : ""}</option>)}</select>{error("brandId")}</label><OptionCreator kind="brand" onCreated={(option) => { setAddedBrands((old) => [...old, option]); set("brandId", option.id); }} /></div>
        <div className="space-y-2"><label className="text-sm">Category<select name="categoryId" required value={values.categoryId} onChange={(e) => set("categoryId", e.target.value)} {...accessibility("categoryId")} className={control}>
          <option value="">Select category</option>{categories.map((c) => <option key={c.id} value={c.id} disabled={c.status !== "active" && c.id !== product?.categoryId}>{c.name}{c.status !== "active" ? " (inactive)" : ""}</option>)}</select>{error("categoryId")}</label><OptionCreator kind="category" onCreated={(option) => { setAddedCategories((old) => [...old, option]); set("categoryId", option.id); }} /></div>
      </div>
      {!product&&<div className="space-y-4">
        <label className="block text-sm">Selling price (PHP)<input required inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)} className={control}/></label>
        <label className="block text-sm">Inventory mode<select value={mode} onChange={e=>setMode(e.target.value)} className={control}><option value="default">Use store default</option><option value="counted">Count stock</option><option value="availability_only">Available / not available</option></select></label>
        <details><summary>Suppliers (optional)</summary><SupplierCreator onCreated={s=>{setAddedSuppliers(old=>[...old,s]);setSelectedSuppliers(old=>({...old,[s.id]:{purchaseCode:"",cost:""}}));}}/><p className="my-2 text-sm">One selling SKU can have several suppliers. Costs below are purchase defaults in PHP.</p>{suppliers.map(s=><div key={s.id} className="my-3 rounded border p-3"><label><input type="checkbox" checked={Boolean(selectedSuppliers[s.id])} onChange={e=>setSelectedSuppliers(old=>{const next={...old};if(e.target.checked)next[s.id]={purchaseCode:"",cost:""};else delete next[s.id];return next;})}/> {s.name}</label>{selectedSuppliers[s.id]&&<div className="grid gap-2 sm:grid-cols-2"><label>Supplier code<input className={control} value={selectedSuppliers[s.id]!.purchaseCode} maxLength={100} onChange={e=>setSelectedSuppliers(old=>({...old,[s.id]:{...old[s.id]!,purchaseCode:e.target.value}}))}/></label><label>Default unit cost (PHP)<input className={control} inputMode="decimal" value={selectedSuppliers[s.id]!.cost} onChange={e=>setSelectedSuppliers(old=>({...old,[s.id]:{...old[s.id]!,cost:e.target.value}}))}/></label></div>}</div>)}</details>
        <details><summary>Advanced: manual SKU</summary><input aria-label="Manual SKU" maxLength={100} value={sku} onChange={e=>setSku(e.target.value)} className={control}/><p className="text-sm">Leave blank to generate a unique SKU. Add physical variants later from product details.</p></details>
        <label className="block text-sm">Thumbnail (optional)<input type="file" accept={productImageTypes.join(",")} className={control} onChange={e=>{const file=e.target.files?.[0]??null;if(file&&(!productImageTypes.some(t=>t===file.type)||file.size>maxProductImageSize||file.size===0)){setMessage("Choose a JPEG, PNG, WebP or AVIF image up to 5 MB.");e.target.value="";setThumbnail(null);return;}setThumbnail(file);}}/></label>
        <p className="text-sm">Your product and selling SKU save together. The optional thumbnail uploads after the product is saved.</p>
      </div>}
      <label className="block text-sm">Short description<textarea name="shortDescription" maxLength={500} rows={3} value={values.shortDescription ?? ""} onChange={(e) => set("shortDescription", e.target.value || null)} {...accessibility("shortDescription")} className={control} />{error("shortDescription")}</label>
      <label className="block text-sm">Description<textarea name="description" maxLength={20000} rows={7} value={values.description ?? ""} onChange={(e) => set("description", e.target.value || null)} {...accessibility("description")} className={control} />{error("description")}</label>
      <label className="block text-sm">Status<select name="status" value={values.status} disabled={product?.status === "archived"} onChange={(e) => set("status", e.target.value as ProductInput["status"])} className={control}>
        <option value="draft">Draft</option><option value="active">Active</option>{product?.status === "archived" && <option value="archived">Archived</option>}</select>
        <span className="mt-1 block text-xs text-muted-foreground">{product?.status === "archived" ? "Use Reactivate on the product details page to restore this product to draft." : "Draft products stay unpublished. Active status allows storefront eligibility."}</span></label>
      <div className="flex flex-wrap gap-6"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="featured" checked={values.featured} onChange={(e) => set("featured", e.target.checked)} />Featured</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="newArrival" checked={values.newArrival} onChange={(e) => set("newArrival", e.target.checked)} />New arrival</label></div>
    </fieldset>
    {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
    {saved && <p role="status">Product saved. <Link className="underline" href={`/admin/products/${createdId}`}>Open product details</Link></p>}
    <div className="flex flex-wrap items-center gap-4"><button disabled={pending || saved || missingOptions} className="rounded-md bg-primary px-5 py-3 text-sm text-primary-foreground disabled:opacity-50">{pending ? "Saving…" : product ? "Save changes" : "Create product"}</button>
      {!product&&!onCreated&&<button type="submit" name="receive" disabled={pending||saved||missingOptions} className="rounded-md border px-5 py-3 text-sm">Save and receive stock</button>}
      <Link href={product ? `/admin/products/${product.id}` : "/admin/products"} className="text-sm underline">Cancel</Link></div>
  </form>;
}
