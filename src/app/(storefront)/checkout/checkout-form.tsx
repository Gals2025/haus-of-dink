"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { placeGuestOrder } from "./actions";
import { peso } from "@/server/commerce/contracts";
import type { CheckoutResult, ShopItem } from "@/server/commerce/guest-contracts";

const field = "min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-base";
export function CheckoutForm({ items, shipping, selected }: { items: ShopItem[]; shipping: number; selected?: string }) {
  const [quantities, setQuantities] = useState<Record<string, number>>(selected ? { [selected]: 1 } : {});
  const [result, setResult] = useState<CheckoutResult>();
  const [pending, start] = useTransition();
  const attempt = useRef<{ payload: string; request: string } | null>(null);
  const subtotal = items.reduce((sum, item) => sum + item.price * (quantities[item.id] ?? 0), 0);
  const count = Object.values(quantities).reduce((a, b) => a + b, 0);
  if (result?.ok) return <section className="space-y-4 rounded-2xl border p-6" role="status">
    <h2 className="text-2xl">Order received</h2>
    <p>Your order reference: <strong className="break-all">{result.id}</strong></p>
    <p>Total: <strong>{peso(result.total)}</strong></p>
    <p>Your order is pending and unpaid. Save this reference and contact the store to arrange payment and delivery. No account is needed.</p>
    <Link href="/shop" className="underline">Back to shop</Link>
  </section>;
  return <form className="space-y-8" onSubmit={e => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const input = {
      action: "order.guest" as const,
      contact: { name: String(data.get("name") ?? ""), email: String(data.get("email") ?? ""), phone: String(data.get("phone") ?? ""), address: String(data.get("address") ?? "") },
      items: items.filter(i => (quantities[i.id] ?? 0) > 0).map(i => ({ variantId: i.id, quantity: quantities[i.id] })),
      promotionCode: String(data.get("promotionCode") ?? ""), notes: String(data.get("notes") ?? ""),
    };
    const payload = JSON.stringify(input);
    if (attempt.current?.payload !== payload) attempt.current = { payload, request: crypto.randomUUID() };
    const request = attempt.current.request;
    start(async () => setResult(await placeGuestOrder(request, input)));
  }}>
    <fieldset disabled={pending} className="min-w-0 space-y-6 disabled:opacity-60">
      <legend className="mb-4 text-xl">Choose your items</legend>
      {items.length === 0 && <p>No products are available yet.</p>}
      {items.map(item => <label key={item.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border p-3 sm:p-4">
        <span className="min-w-0 break-words"><strong>{item.name}</strong><span className="block text-sm text-muted-foreground">{item.sku} · {peso(item.price)} · {item.available ? `Up to ${item.available} available` : "Out of stock"}</span></span>
        <span className="flex items-center gap-3">Quantity<input aria-label={`Quantity for ${item.name}, ${item.sku}`} type="number" inputMode="numeric" min={0} max={item.available} step={1} value={quantities[item.id] ?? 0} disabled={!item.available} className={`${field} max-w-24`} onChange={e => setQuantities(v => ({ ...v, [item.id]: Number(e.target.value) }))} /></span>
      </label>)}
      <h2 className="text-xl">Your contact and delivery details</h2>
      <div className="grid min-w-0 gap-4 [&>label]:min-w-0 sm:grid-cols-2">
        <label>Full name<input name="name" autoComplete="name" required maxLength={160} className={field} /></label>
        <label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} className={field} /></label>
        <label>Contact number<input name="phone" type="tel" autoComplete="tel" required minLength={7} maxLength={40} className={field} /></label>
        <label>Promotion code (optional)<input name="promotionCode" maxLength={40} className={field} /></label>
      </div>
      <label className="block">Complete delivery address<textarea name="address" autoComplete="street-address" required minLength={5} maxLength={1000} className={field} /></label>
      <label className="block">Order notes (optional)<textarea name="notes" maxLength={1000} className={field} /></label>
      <div className="space-y-2 rounded-xl bg-muted p-5" aria-live="polite">
        <p>Items: {peso(subtotal)}</p><p>Delivery fee: {peso(shipping)}</p>
        <p className="font-semibold">Total before promotion: {peso(subtotal + shipping)}</p>
        <p className="text-sm">Prices, stock and promotions are checked when you place the order. The final total appears in your confirmation. Payment is arranged with the store after ordering.</p>
      </div>
      {result && !result.ok && <p role="alert" className="text-destructive">{result.error}</p>}
      <button type="submit" disabled={pending || !count || count > 300} className="min-h-12 w-full rounded-lg bg-primary px-6 py-3 sm:w-auto font-medium text-primary-foreground disabled:opacity-50">{pending ? "Placing order…" : "Place guest order"}</button>
    </fieldset>
  </form>;
}
