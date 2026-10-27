import { catalogManagement } from "@/server/catalog/management";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, hasPermission } from "@/server/auth/authorize";
import { getProductDetail, listProductOptions } from "@/server/catalog/service";
import { VariantForm } from "../variant-form";
import { ProductStatusControls } from "../status-controls";

export default async function ProductPage({ params, searchParams }: {
  params: Promise<{ productId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await requirePermission("inventory:read");
  const { productId } = await params;
  const [result, options, query, managed] = await Promise.all([getProductDetail(productId), listProductOptions(), searchParams, catalogManagement.list()]);
  if (!result.ok) {
    if (result.code === "NOT_FOUND" || result.code === "VALIDATION") notFound();
    return <p role="alert">{result.error}</p>;
  }
  const attributes = managed.ok ? managed.attributes.map((a) => ({ id: a.id, name: a.name, values: managed.values.filter((v) => v.attributeId === a.id).map((v) => ({ id: v.id, value: v.name })) })) : [];
  const p = result.product; const canWrite = hasPermission(identity.staff.role, "inventory:write");
  return <div className="space-y-6">
    <Link className="text-sm underline" href="/admin/products">Back to products</Link>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs tracking-widest text-primary">HAUS OF DINK / CATALOG</p>
      <h1 className="mt-3 text-4xl">{p.name}</h1><p className="mt-2 text-sm text-muted-foreground">{p.slug}</p></div>
      {canWrite && <Link className="rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground" href={`/admin/products/${p.id}/edit`}>Edit product</Link>}</header>
    {(query.saved === "created" || query.saved === "updated") && <p role="status" className="rounded-lg border bg-secondary p-4 text-sm">Product {query.saved === "created" ? "created" : "saved"} successfully.</p>}
    <section aria-label="Product information" className="space-y-5 rounded-xl border bg-card p-5">
      <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="mt-1 capitalize">{p.status}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Brand</dt><dd className="mt-1">{options.ok ? options.brands.find((b) => b.id === p.brandId)?.name ?? "Unavailable" : "Unavailable"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Category</dt><dd className="mt-1">{options.ok ? options.categories.find((c) => c.id === p.categoryId)?.name ?? "Unavailable" : "Unavailable"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Flags</dt><dd className="mt-1">{[p.featured && "Featured", p.newArrival && "New arrival"].filter(Boolean).join(" · ") || "None"}</dd></div>
      </dl>
      <div><h2 className="font-medium">Short description</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{p.shortDescription || "No short description."}</p></div>
      <div><h2 className="font-medium">Description</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{p.description || "No description."}</p></div>
    </section>
    <section className="space-y-3"><h2 className="text-2xl">Variants</h2><p className="text-sm text-muted-foreground">Each SKU tracks its own stock. Add a SKU, then receive its opening stock or deliveries.</p>
      <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full text-left text-sm"><caption className="sr-only">Existing product variants</caption>
        <thead className="border-b bg-muted/50"><tr>{["SKU", "Options", "Barcode", "Price", "Unit cost", "Compare-at price", "Status"].map((label) => <th key={label} scope="col" className="p-4">{label}</th>)}</tr></thead>
        <tbody>{p.variants.map((v) => <tr key={v.id} className="border-b last:border-0"><td className="p-4">{v.sku}</td><td className="p-4">{v.attributes.map((a) => `${a.name}: ${a.value}`).join(" · ") || "—"}</td><td className="p-4">{v.barcode || "—"}</td>
          <td className="p-4 whitespace-nowrap">{v.currency} {(v.price / 100).toFixed(2)}</td><td className="p-4 whitespace-nowrap">{v.cost === null ? "—" : `${v.currency} ${(v.cost / 100).toFixed(2)}`}</td><td className="p-4 whitespace-nowrap">{v.compareAtPrice === null ? "—" : `${v.currency} ${(v.compareAtPrice / 100).toFixed(2)}`}</td><td className="p-4 capitalize">{v.status}</td></tr>)}
          {!p.variants.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No variants yet.</td></tr>}</tbody></table></div>
      {canWrite && p.status !== "archived" && managed.ok && <VariantForm attributes={attributes} productId={p.id} productSlug={p.slug} existingSkus={p.variants.map((v) => v.sku)} />}
      {!managed.ok && <p role="alert">Attribute options unavailable. Refresh before editing variants.</p>}
      {canWrite && p.status !== "archived" && managed.ok && p.variants.map((v) => <VariantForm key={v.id} variant={v} attributes={attributes} productId={p.id} productSlug={p.slug} existingSkus={p.variants.map((item) => item.sku)} />)}
      {canWrite && p.status !== "archived" && p.variants.filter((v) => v.status === "active").map((v) => <Link key={v.id} className="mr-4 inline-block text-sm underline" href={`/admin/inventory/adjustments?variantId=${v.id}&type=PURCHASE`}>Receive stock: {v.sku}</Link>)}
      <Link className="inline-block text-sm underline" href="/admin/inventory">Open inventory</Link>
    </section>
    <section className="space-y-3"><h2 className="text-2xl">Images</h2>{p.images.length ? <ul className="grid gap-4 sm:grid-cols-2">{p.images.map((i) => <li key={i.id} className="flex items-start gap-4 rounded-xl border bg-card p-4">
      <Image unoptimized src={i.blobUrl} alt={i.altText} width={96} height={96} className="size-24 rounded-md object-contain" />
      <div><p className="break-words text-sm">{i.altText}</p><p className="mt-1 text-xs text-muted-foreground">{i.variantId ? `Variant: ${p.variants.find((v) => v.id === i.variantId)?.sku ?? "Unavailable"}` : "Product image"}{i.isPrimary ? " · Primary" : ""}</p></div>
    </li>)}</ul> : <p className="text-sm text-muted-foreground">No images yet.</p>}</section>
    {canWrite && <ProductStatusControls productId={p.id} status={p.status} />}
  </div>;
}
