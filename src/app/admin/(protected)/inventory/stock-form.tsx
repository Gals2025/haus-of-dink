"use client";
import { useActionState, useState } from "react";
import { manualTypes } from "@/server/inventory/contracts";
import { recordStock } from "./actions";

export function StockForm({ variantId, sku, locationId, requestId, initialType = "OPENING_STOCK" }: { initialType?: typeof manualTypes[number]; variantId: string; sku: string; locationId: string; requestId: string }) {
  const [currentRequestId, setCurrentRequestId] = useState(requestId);
  return <MovementForm key={currentRequestId} variantId={variantId} sku={sku} locationId={locationId} requestId={currentRequestId} initialType={initialType} onNew={() => setCurrentRequestId(crypto.randomUUID())} />;
}

function MovementForm({ variantId, sku, locationId, requestId, initialType, onNew }: { initialType: typeof manualTypes[number]; variantId: string; sku: string; locationId: string; requestId: string; onNew: () => void }) {
  const [state, action, pending] = useActionState(recordStock, null);
  if (state?.ok) return <div role="status" className="space-y-3 rounded-xl border bg-card p-6">
    <p>Stock movement recorded for {sku}.</p><p className="text-sm text-muted-foreground">Movement ID: {state.movementId}</p>
    <button onClick={onNew} className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Record another movement</button>
  </div>;
  return <form action={action} className="max-w-xl space-y-5 rounded-xl border bg-card p-6">
    <input type="hidden" name="requestId" value={requestId} /><input type="hidden" name="variantId" value={variantId} /><input type="hidden" name="locationId" value={locationId} />
    <p className="font-medium">SKU: {sku}</p>
    <label className="block text-sm">Movement type<select required name="type" defaultValue={initialType} className="mt-1 block w-full rounded-md border bg-background p-3">
      {manualTypes.map((type) => <option key={type} value={type}>{type === "PURCHASE" ? "Receive stock (purchase / delivery)" : type === "OPENING_STOCK" ? "Opening stock (items already on hand)" : type.replaceAll("_", " ")}</option>)}
    </select></label>
    <label className="block text-sm">Quantity<input name="quantity" required type="number" min={1} max={1000000} step={1} className="mt-1 block w-full rounded-md border bg-background p-3" /></label>
    <label className="block text-sm">Reference (purchase order, return or document)<input name="reference" maxLength={200} className="mt-1 block w-full rounded-md border bg-background p-3" /></label>
    <label className="block text-sm">Reason<textarea name="reason" required minLength={3} maxLength={500} className="mt-1 block w-full rounded-md border bg-background p-3" /></label>
    {state && !state.ok && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    <p className="text-sm text-muted-foreground">This adds a permanent history entry. Correct mistakes with a new movement and explain the correction.</p>
    <button disabled={pending} className="rounded-md bg-primary px-4 py-3 text-primary-foreground disabled:opacity-50">{pending ? "Recording…" : "Record movement"}</button>
  </form>;
}
