"use client";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveReorderLevel } from "./actions";

export function ReorderForm({ variantId, locationId, sku, level }: { variantId: string; locationId: string; sku: string; level: number }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const raw = String(new FormData(event.currentTarget).get("reorderLevel") ?? "");
    setMessage("");
    startTransition(async () => {
      try {
        const result = await saveReorderLevel({ variantId, locationId, reorderLevel: raw.trim() === "" ? NaN : Number(raw) });
        setFailed(!result.ok);
        setMessage(result.ok ? "Reorder level saved." : result.error);
        if (result.ok) { setEditing(false); router.refresh(); }
      } catch { setFailed(true); setMessage("Save not confirmed. Refresh to check the reorder level."); }
    });
  }
  return <div className="min-w-40 space-y-2">
    {!editing ? <div className="flex items-center gap-3"><span>{level}</span><button type="button" className="text-xs underline" aria-label={`Edit reorder level for ${sku}`} onClick={() => { setEditing(true); setMessage(""); }}>Edit</button></div>
      : <form onSubmit={submit} className="space-y-2">
        <label className="block text-xs">Reorder level for {sku}<input autoFocus required name="reorderLevel" aria-label={`Reorder level for ${sku}`} type="number" min={0} max={1000000} step={1} defaultValue={level} disabled={pending} className="mt-1 block w-28 rounded-md border bg-background p-2" /></label>
        <p className="max-w-52 text-xs text-muted-foreground">Low stock when available quantity is at or below this level at the selected location.</p>
        <div className="flex gap-3"><button disabled={pending} className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50">{pending ? "Saving…" : "Save"}</button><button type="button" disabled={pending} className="text-xs underline" onClick={() => { setEditing(false); setMessage(""); }}>Cancel</button></div>
      </form>}
    {message && <p role={failed ? "alert" : "status"} className={`max-w-52 text-xs ${failed ? "text-destructive" : "text-muted-foreground"}`}>{message}</p>}
  </div>;
}
