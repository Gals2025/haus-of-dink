"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { archiveCatalogProduct, reactivateCatalogProduct } from "./actions";

export function ProductStatusControls({ productId, status }: { productId: string; status: string }) {
  const router = useRouter(); const [confirm, setConfirm] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const archived = status === "archived";
  function apply() {
    if (pending) return;
    startTransition(async () => {
      try {
        const result = await (archived ? reactivateCatalogProduct(productId) : archiveCatalogProduct(productId));
        if (!result.ok) { setFeedback({ error: true, text: result.error }); return; }
        setConfirm(false); setFeedback({ error: false, text: result.changed ? archived ? "Product restored to draft." : "Product archived." : "No status change was needed." });
        router.refresh();
      } catch { setFeedback({ error: true, text: "Change not confirmed. Refresh to check the product status before retrying." }); }
    });
  }
  return <section aria-label="Product status controls" className="space-y-4 rounded-xl border bg-card p-5">
    <h2 className="text-xl">{archived ? "Reactivate product" : "Archive product"}</h2>
    <p className="text-sm text-muted-foreground">{archived ? "Restore this product to draft. It will remain unpublished until you explicitly activate it." : "Remove this product from active use while preserving its variants and inventory history."}</p>
    {!confirm ? <button onClick={() => { setFeedback(null); setConfirm(true); }} className="rounded-md border px-4 py-2 text-sm">{archived ? "Reactivate" : "Archive"}</button>
      : <div role="group" aria-label="Confirm status change" className="space-y-3"><p className="text-sm">{archived ? "Restore this product to draft?" : "Archive this product?"}</p>
        <div className="flex gap-4"><button disabled={pending} onClick={apply} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{pending ? "Saving…" : archived ? "Confirm reactivation" : "Confirm archive"}</button>
          <button disabled={pending} onClick={() => setConfirm(false)} className="text-sm underline">Cancel</button></div></div>}
    {feedback && <p role={feedback.error ? "alert" : "status"} className={feedback.error ? "text-sm text-destructive" : "text-sm"}>{feedback.text}</p>}
  </section>;
}
