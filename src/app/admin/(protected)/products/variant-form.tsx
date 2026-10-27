"use client";
import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addProductVariant } from "./actions";

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

export function VariantForm({ productId, productSlug, existingSkus }: { productId: string; productSlug: string; existingSkus: string[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
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
        const result = await addProductVariant({ productId, sku: data.get("sku"), barcode: String(data.get("barcode") ?? "").trim() || null,
          price: money("price"), cost: money("cost"), compareAtPrice: money("compareAtPrice"), currency: "PHP" });
        if (!result.ok) { setMessage(result.error); return; }
        setAddedSkus((previous) => [...previous, String(data.get("sku") ?? "")]);
        setVariantId(result.variantId);
        form.reset();
        router.refresh();
      } catch { setMessage("Save not confirmed. Refresh and check the SKU list before retrying."); }
    });
  }
  if (variantId) return <div role="status" className="space-y-3 rounded-xl border bg-card p-5">
    <p>SKU added. Receive stock to record its opening quantity or a delivery.</p>
    <Link className="inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground" href={`/admin/inventory/adjustments?variantId=${variantId}&type=PURCHASE`}>Receive stock</Link>
    <button type="button" className="ml-4 underline" onClick={() => setVariantId(null)}>Add another SKU</button>
  </div>;
  return <details className="rounded-xl border bg-card p-5"><summary className="cursor-pointer font-medium">Add SKU / variant</summary>
    <p className="mt-3 text-sm text-muted-foreground">Add one SKU for a simple product, or a separate SKU for each color or size. Prices are in PHP. Stock starts at zero.</p>
    <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="text-sm">SKU<input required name="sku" defaultValue={suggestedSku} aria-describedby="sku-pattern" maxLength={100} className="mt-1 block w-full rounded-md border bg-background p-3" /></label>
      <p id="sku-pattern" className="text-xs text-muted-foreground sm:col-span-2">Suggested pattern: 3 letters per word (up to 4 words) + number, e.g. DAL-PIN-OVE-001. You can edit it to include color or size. Keep the SKU unchanged when receiving more of the same item.</p>
      <label className="text-sm">Barcode (optional)<input name="barcode" maxLength={100} className="mt-1 block w-full rounded-md border bg-background p-3" /></label>
      <label className="text-sm">Selling price (PHP)<input required name="price" type="number" min="0" max="21474836.47" step="0.01" className="mt-1 block w-full rounded-md border bg-background p-3" /></label>
      <label className="text-sm">Unit cost (PHP, optional)<input name="cost" type="number" min="0" max="21474836.47" step="0.01" className="mt-1 block w-full rounded-md border bg-background p-3" /></label>
      <label className="text-sm">Compare-at price (PHP, optional)<input name="compareAtPrice" type="number" min="0" max="21474836.47" step="0.01" className="mt-1 block w-full rounded-md border bg-background p-3" /></label>
      {message && <p role="alert" className="text-sm text-destructive sm:col-span-2">{message}</p>}
      <button disabled={pending} className="rounded-md bg-primary px-4 py-3 text-primary-foreground disabled:opacity-50 sm:col-span-2">{pending ? "Adding…" : "Add SKU"}</button>
    </form>
  </details>;
}
