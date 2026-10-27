"use client";
import { useId, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProductDetail } from "@/server/catalog/contracts";
import type { AttributeOption } from "@/server/catalog/management-contracts";
import { addProductVariant, editProductVariant, removeProductVariant } from "./actions";

function suggestSku(slug: string, existingSkus: string[]) {
  const used = new Set(existingSkus.map((sku) => sku.trim().toUpperCase()));
  const prefix = slug.split("-").filter(Boolean).slice(0, 4).map((word) => word.slice(0, 3)).join("-").toUpperCase();
  for (let number = 1; number <= used.size + 1; number++) {
    const suffix = `-${String(number).padStart(3, "0")}`;
    const candidate = `${prefix.slice(0, 100 - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return "";
}

export function VariantForm({ productId, productSlug, existingSkus, attributes = [], variant }: { productId: string; productSlug: string; existingSkus: string[]; attributes?: AttributeOption[]; variant?: ProductDetail["variants"][number] }) {
  const router = useRouter();
  const patternId = useId();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState("");
  const [addedSkus, setAddedSkus] = useState<string[]>([]);
  const suggestedSku = suggestSku(productSlug, [...existingSkus, ...addedSkus]);
  const [variantId, setVariantId] = useState<string | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const money = (key: string) => {
      const value = String(data.get(key) ?? "").trim();
      return value === "" ? null : /^\d+(\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : NaN;
    };
    setMessage("");
    startTransition(async () => {
      try {
        const input = { productId, sku: data.get("sku"), barcode: String(data.get("barcode") ?? "").trim() || null,
          price: money("price"), cost: money("cost"), compareAtPrice: money("compareAtPrice"), currency: variant?.currency ?? "PHP", status: data.get("status"),
          attributeValueIds: attributes.map((a) => String(data.get(`attribute-${a.id}`) ?? "")).filter(Boolean) };
        const result = variant ? await editProductVariant(variant.id, input) : await addProductVariant(input);
        if (!result.ok) { setMessage(result.error); return; }
        if (variant) { setMessage("Variant saved."); router.refresh(); return; }
        setAddedSkus((previous) => [...previous, String(data.get("sku") ?? "")]);
        setVariantId(result.variantId);
        form.reset();
        router.refresh();
      } catch { setMessage("Save not confirmed. Refresh and check the SKU list before retrying."); }
    });
  }
  function remove() {
    if (!variant || pending) return;
    startTransition(async () => {
      try { const result = await removeProductVariant(variant.id, productId); if (!result.ok) { setMessage(result.error); return; } router.refresh(); }
      catch { setMessage("Deletion not confirmed. Refresh before retrying."); }
    });
  }
  if (variantId) return <div role="status" className="space-y-3 rounded-xl border bg-card p-5">
    <p>SKU added. Receive stock to record its opening quantity or a delivery.</p>
    <Link className="inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground" href={`/admin/inventory/adjustments?variantId=${variantId}&type=PURCHASE`}>Receive stock</Link>
    <button type="button" className="ml-4 underline" onClick={() => setVariantId(null)}>Add another SKU</button>
  </div>;
  return <details className="rounded-xl border bg-card p-5"><summary className="cursor-pointer font-medium">{variant ? `Edit ${variant.sku}` : "Add SKU / variant"}</summary>
    <p className="mt-3 text-sm text-muted-foreground">{variant ? "Update prices, barcode, attributes or status. Existing inventory history stays linked to this SKU." : "Add one SKU for a simple product, or a separate SKU for each color or size. Prices are in PHP. Stock starts at zero."}</p>
    <form onSubmit={submit} className="mt-4"><fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm">SKU<input required name="sku" defaultValue={variant?.sku ?? suggestedSku} aria-describedby={patternId} maxLength={100} className="mt-1 block w-full rounded-md border bg-background p-3" /></label>
      <p id={patternId} className="text-xs text-muted-foreground sm:col-span-2">Suggested pattern: 3 letters per word (up to 4 words) + number, e.g. DAL-PIN-OVE-001. You can edit it to include color or size. Keep the SKU unchanged when receiving more of the same item.</p>
      <label className="text-sm">Barcode (optional)<input name="barcode" defaultValue={variant?.barcode ?? ""} maxLength={100} className="mt-1 block w-full rounded-md border bg-background p-3" /></label>
      <label className="text-sm">Selling price ({variant?.currency ?? "PHP"})<input required name="price" defaultValue={variant?.price == null ? "" : (variant.price / 100).toFixed(2)} type="number" min="0" max="21474836.47" step="0.01" className="mt-1 block w-full rounded-md border bg-background p-3" /></label>
      <label className="text-sm">Unit cost ({variant?.currency ?? "PHP"}, optional)<input name="cost" defaultValue={variant?.cost == null ? "" : (variant.cost / 100).toFixed(2)} type="number" min="0" max="21474836.47" step="0.01" className="mt-1 block w-full rounded-md border bg-background p-3" /></label>
      <label className="text-sm">Compare-at price ({variant?.currency ?? "PHP"}, optional)<input name="compareAtPrice" defaultValue={variant?.compareAtPrice == null ? "" : (variant.compareAtPrice / 100).toFixed(2)} type="number" min="0" max="21474836.47" step="0.01" className="mt-1 block w-full rounded-md border bg-background p-3" /></label>
      <label className="text-sm">Status<select name="status" defaultValue={variant?.status ?? "active"} className="mt-1 block w-full rounded-md border bg-background p-3"><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      {attributes.map((a) => <label key={a.id} className="text-sm">{a.name}<select name={`attribute-${a.id}`} defaultValue={variant?.attributes.find((v) => v.attributeId === a.id)?.id ?? ""} className="mt-1 block w-full rounded-md border bg-background p-3"><option value="">Not specified</option>{a.values.map((v) => <option key={v.id} value={v.id}>{v.value}</option>)}</select></label>)}
      {!attributes.length && <p className="text-sm text-muted-foreground sm:col-span-2">Define attributes and values in <Link href="/admin/catalog" className="underline">Categories &amp; brands</Link> to add color or size options.</p>}
      {message && <p role="status" className="text-sm text-destructive sm:col-span-2">{message}</p>}
      <button disabled={pending} className="rounded-md bg-primary px-4 py-3 text-primary-foreground disabled:opacity-50 sm:col-span-2">{pending ? "Saving…" : variant ? "Save variant" : "Add SKU"}</button>
    </fieldset></form>
    {variant && <div className="mt-4 text-sm">{confirmDelete ? <div role="alertdialog" aria-labelledby={`delete-${variant.id}`} className="space-y-2"><p id={`delete-${variant.id}`}>Permanently delete {variant.sku}? Only unused SKUs without stock or history can be deleted.</p><button type="button" disabled={pending} onClick={remove} className="mr-4 text-destructive underline">Confirm deletion</button><button type="button" disabled={pending} onClick={() => setConfirmDelete(false)} className="underline">Cancel</button></div> : <button type="button" disabled={pending} onClick={() => setConfirmDelete(true)} className="text-destructive underline">Delete unused variant</button>}</div>}
  </details>;
}
