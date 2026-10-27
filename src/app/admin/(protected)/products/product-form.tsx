"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { createProductInput, normalizeSlug, type ProductInput, type Product } from "@/server/catalog/contracts";
import { changedProductFields } from "@/server/catalog/admin-input";
import type { ProductOptions } from "@/server/catalog/service";
import { createCatalogProduct, updateCatalogProduct } from "./actions";

const control = "mt-1 block w-full rounded-md border bg-background p-3 disabled:opacity-60";
export function ProductForm({ product, options }: { product?: Product; options: ProductOptions }) {
  const router = useRouter();
  const initial: ProductInput = product ? {
    name: product.name, slug: product.slug, description: product.description, shortDescription: product.shortDescription,
    brandId: product.brandId, categoryId: product.categoryId, status: product.status, featured: product.featured, newArrival: product.newArrival,
  } : { name: "", slug: "", description: null, shortDescription: null, brandId: "", categoryId: "", status: "draft", featured: false, newArrival: false };
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
    const parsed = createProductInput.safeParse(values);
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      setMessage("Check the highlighted fields."); return;
    }
    setFieldErrors({}); setMessage("");
    startTransition(async () => {
      try {
        const result = product ? await updateCatalogProduct(product.id, changedProductFields(initial, parsed.data)) : await createCatalogProduct(parsed.data);
        if (!result.ok) { setMessage(result.error); return; }
        setSaved(true);
        router.push(`/admin/products/${result.productId}?saved=${product ? "updated" : "created"}`);
        router.refresh();
      } catch { setMessage("Save not confirmed. Refresh and check the product before retrying."); }
    });
  }
  const missingOptions = !options.brands.length || !options.categories.length;
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
        <label className="text-sm">Brand<select name="brandId" required value={values.brandId} onChange={(e) => set("brandId", e.target.value)} {...accessibility("brandId")} className={control}>
          <option value="">Select brand</option>{options.brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.status !== "active" ? " (inactive)" : ""}</option>)}</select>{error("brandId")}</label>
        <label className="text-sm">Category<select name="categoryId" required value={values.categoryId} onChange={(e) => set("categoryId", e.target.value)} {...accessibility("categoryId")} className={control}>
          <option value="">Select category</option>{options.categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.status !== "active" ? " (inactive)" : ""}</option>)}</select>{error("categoryId")}</label>
      </div>
      <label className="block text-sm">Short description<textarea name="shortDescription" maxLength={500} rows={3} value={values.shortDescription ?? ""} onChange={(e) => set("shortDescription", e.target.value || null)} {...accessibility("shortDescription")} className={control} />{error("shortDescription")}</label>
      <label className="block text-sm">Description<textarea name="description" maxLength={20000} rows={7} value={values.description ?? ""} onChange={(e) => set("description", e.target.value || null)} {...accessibility("description")} className={control} />{error("description")}</label>
      <label className="block text-sm">Status<select name="status" value={values.status} disabled={product?.status === "archived"} onChange={(e) => set("status", e.target.value as ProductInput["status"])} className={control}>
        <option value="draft">Draft</option><option value="active">Active</option>{product?.status === "archived" && <option value="archived">Archived</option>}</select>
        <span className="mt-1 block text-xs text-muted-foreground">{product?.status === "archived" ? "Use Reactivate on the product details page to restore this product to draft." : "Draft products stay unpublished. Active status allows storefront eligibility."}</span></label>
      <div className="flex flex-wrap gap-6"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="featured" checked={values.featured} onChange={(e) => set("featured", e.target.checked)} />Featured</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="newArrival" checked={values.newArrival} onChange={(e) => set("newArrival", e.target.checked)} />New arrival</label></div>
    </fieldset>
    {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
    {saved && <p role="status">Product saved. Opening details… <Link className="underline" href="/admin/products">View products</Link></p>}
    <div className="flex flex-wrap items-center gap-4"><button disabled={pending || saved || missingOptions} className="rounded-md bg-primary px-5 py-3 text-sm text-primary-foreground disabled:opacity-50">{pending ? "Saving…" : product ? "Save changes" : "Create product"}</button>
      <Link href={product ? `/admin/products/${product.id}` : "/admin/products"} className="text-sm underline">Cancel</Link></div>
  </form>;
}
