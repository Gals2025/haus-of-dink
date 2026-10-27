"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, ShoppingBag, Trash2 } from "lucide-react";
import { placeGuestOrder } from "./actions";
import { peso } from "@/server/commerce/contracts";
import type { CheckoutResult, ShopItem } from "@/server/commerce/guest-contracts";

const field = "mt-1.5 min-h-11 w-full min-w-0 rounded-lg border bg-white px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary";

export function CheckoutForm({ items, shipping, selected }: { items: ShopItem[]; shipping: number; selected?: string }) {
  const [quantities, setQuantities] = useState<Record<string, number>>(selected ? { [selected]: 1 } : {});
  const [result, setResult] = useState<CheckoutResult>();
  const [pending, start] = useTransition();
  const attempt = useRef<{ payload: string; request: string } | null>(null);
  const chosen = items.filter(i => (quantities[i.id] ?? 0) > 0);
  const remaining = items.filter(i => i.available > 0 && !((quantities[i.id] ?? 0) > 0));
  const subtotal = chosen.reduce((sum, item) => sum + item.price * (quantities[item.id] ?? 0), 0);
  const count = chosen.reduce((sum, item) => sum + (quantities[item.id] ?? 0), 0);

  if (result?.ok) return (
    <section className="space-y-4 rounded-2xl border bg-white p-5 sm:p-8" role="status">
      <CheckCircle2 className="size-10 text-primary" aria-hidden="true" />
      <h2 className="text-3xl">Thank you! Order received.</h2>
      <p className="text-sm text-muted-foreground">Save your reference and contact the store to arrange payment and delivery.</p>
      <dl className="space-y-3 rounded-xl bg-muted p-4 text-sm">
        <div><dt className="text-muted-foreground">Order reference</dt><dd className="mt-1 break-all font-semibold">{result.id}</dd></div>
        <div className="flex justify-between gap-3"><dt>Total</dt><dd className="font-semibold">{peso(result.total)}</dd></div>
        <div className="flex justify-between gap-3"><dt>Payment</dt><dd>Pending · Unpaid</dd></div>
      </dl>
      <Link href="/shop" className="inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground">Continue shopping</Link>
    </section>
  );

  if (!chosen.length) return (
    <section className="rounded-2xl border bg-white px-5 py-12 text-center">
      <ShoppingBag className="mx-auto mb-4 size-10 text-primary/50" aria-hidden="true" />
      <h2 className="text-2xl">Your order is empty</h2>
      <p className="mt-2 text-sm text-muted-foreground">Choose something you love from the shop to get started.</p>
      <Link href="/shop" className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground">Browse the shop</Link>
    </section>
  );

  return (
    <form onSubmit={e => {
      e.preventDefault();
      if (pending) return;
      const data = new FormData(e.currentTarget);
      const input = {
        action: "order.guest" as const,
        contact: {
          name: String(data.get("name") ?? ""), email: String(data.get("email") ?? ""),
          phone: String(data.get("phone") ?? ""), address: String(data.get("address") ?? ""),
        },
        items: chosen.map(i => ({ variantId: i.id, quantity: quantities[i.id] ?? 0 })),
        promotionCode: String(data.get("promotionCode") ?? ""), notes: String(data.get("notes") ?? ""),
      };
      const payload = JSON.stringify(input);
      if (attempt.current?.payload !== payload) attempt.current = { payload, request: crypto.randomUUID() };
      const request = attempt.current.request;
      start(async () => {
        try { setResult(await placeGuestOrder(request, input)); }
        catch { setResult({ ok: false, error: "Couldn't connect. Please try again." }); }
      });
    }}>
      <fieldset disabled={pending} className="min-w-0 space-y-4 disabled:opacity-60">
        <legend className="sr-only">Your order and delivery details</legend>
        <section aria-labelledby="order-heading" className="rounded-2xl border bg-white p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="order-heading" className="font-sans text-lg font-semibold">Your order</h2>
            <span className="text-xs text-muted-foreground">{count} {count === 1 ? "item" : "items"}</span>
          </div>
          <ul className="divide-y">
            {chosen.map(item => (
              <li key={item.id} className="flex min-w-0 items-start gap-3 py-4 first:pt-0">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold">{item.name}</p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">{item.sku}</p>
                  <p className="mt-2 text-sm font-semibold">{peso(item.price * (quantities[item.id] ?? 0))}</p>
                  <label className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
                    Qty
                    <select aria-label={`Quantity for ${item.name}, ${item.sku}`} value={quantities[item.id]} onChange={e => setQuantities(v => ({ ...v, [item.id]: Number(e.target.value) }))} className="min-h-11 rounded-lg border bg-white px-3 text-base text-foreground focus-visible:ring-2 focus-visible:ring-primary">
                      {Array.from({ length: item.available }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                    </select>
                  </label>
                </div>
                <button type="button" aria-label={`Remove ${item.name}, ${item.sku}`} onClick={() => setQuantities(v => ({ ...v, [item.id]: 0 }))} className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"><Trash2 className="size-4" /></button>
              </li>
            ))}
          </ul>
          {remaining.length > 0 && chosen.length < 30 && (
            <details className="border-t pt-3 text-sm">
              <summary className="min-h-11 cursor-pointer py-3 font-medium text-primary">Add another item</summary>
              <label className="block pb-1"><span className="sr-only">Product to add</span>
                <select aria-label="Product to add" value="" onChange={e => { if (e.target.value) setQuantities(v => ({ ...v, [e.target.value]: 1 })); }} className={field}>
                  <option value="">Choose a product</option>
                  {remaining.map(item => <option key={item.id} value={item.id}>{item.name} · {item.sku} · {peso(item.price)}</option>)}
                </select>
              </label>
            </details>
          )}
        </section>

        <section aria-labelledby="delivery-heading" className="space-y-4 rounded-2xl border bg-white p-4 sm:p-6">
          <h2 id="delivery-heading" className="font-sans text-lg font-semibold">Delivery details</h2>
          <label className="block text-sm font-medium">Full name<input name="name" autoComplete="name" required maxLength={160} className={field} /></label>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="min-w-0 text-sm font-medium">Phone number<input name="phone" type="tel" autoComplete="tel" required minLength={7} maxLength={40} className={field} /></label>
            <label className="min-w-0 text-sm font-medium">Email<input name="email" type="email" autoComplete="email" required maxLength={254} className={field} /></label>
          </div>
          <label className="block text-sm font-medium">Delivery address<textarea name="address" autoComplete="street-address" required minLength={5} maxLength={1000} rows={2} placeholder="House / unit, street, barangay, city, province, postal code" className={field} /></label>
          <details className="border-t pt-1 text-sm">
            <summary className="min-h-11 cursor-pointer py-3 text-muted-foreground">Have a promo code or order note?</summary>
            <div className="space-y-3 pb-1">
              <label className="block">Promo code (optional)<input name="promotionCode" maxLength={40} className={field} /></label>
              <label className="block">Order note (optional)<textarea name="notes" maxLength={1000} rows={2} className={field} /></label>
            </div>
          </details>
        </section>

        <section aria-label="Order total" className="space-y-3 rounded-2xl border bg-white p-4 sm:p-6">
          <dl className="space-y-2 text-sm" aria-live="polite">
            <div className="flex justify-between gap-3"><dt>Subtotal</dt><dd>{peso(subtotal)}</dd></div>
            <div className="flex justify-between gap-3"><dt>Delivery</dt><dd>{peso(shipping)}</dd></div>
            <div className="flex justify-between gap-3 border-t pt-3 text-lg font-semibold"><dt>Total <span className="text-xs font-normal text-muted-foreground">before promo</span></dt><dd>{peso(subtotal + shipping)}</dd></div>
          </dl>
          <p className="text-xs leading-relaxed text-muted-foreground">Payment is arranged with the store after ordering. Any promo discount is confirmed when you place your order.</p>
          {result && !result.ok && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{result.error}</p>}
          <button type="submit" disabled={pending || !count || chosen.length > 30} className="min-h-12 w-full rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50">{pending ? "Placing order…" : "Place order"}</button>
        </section>
      </fieldset>
    </form>
  );
}
