"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, ShoppingBag, Trash2 } from "lucide-react";
import { addCartItem,completeCartPurchase,ensureCartItem,setCartQuantity,useCart } from "@/lib/cart/store";
import { placeGuestOrder } from "./actions";
import { peso } from "@/server/commerce/contracts";
import type { CheckoutResult, ShopItem } from "@/server/commerce/guest-contracts";

const field = "mt-1.5 min-h-11 w-full min-w-0 rounded-lg border bg-white px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary";

export function CheckoutForm({ items, shipping, paymentInstructions, selected }: { items: ShopItem[]; shipping: number; paymentInstructions: string; selected?: string }) {
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("delivery");
  const [pickupPayment, setPickupPayment] = useState<"online" | "upon_pickup">("online");
  const [proofPath, setProofPath] = useState("");
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const {lines,ready}=useCart();
  const selectedHandled=useRef<string|undefined>(undefined);
  useEffect(()=>{
    if(selected&&selectedHandled.current!==selected){
      selectedHandled.current=selected;
      ensureCartItem(selected,items.find(item=>item.id===selected)?.available??0);
    }
  },[selected,items]);
  const quantities:Record<string,number>=Object.fromEntries(lines.map(line=>[line.variantId,line.quantity]));
  const cartInvalid=lines.some(line=>{const item=items.find(item=>item.id===line.variantId);return !item||item.available<line.quantity;});
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
      <p className="text-sm text-muted-foreground">Your order is awaiting admin confirmation. Save this reference to track its progress.</p>
      <dl className="space-y-3 rounded-xl bg-muted p-4 text-sm">
        <div><dt className="text-muted-foreground">Order reference</dt><dd className="mt-1 break-all font-semibold">{result.id}</dd></div>
        <div className="flex justify-between gap-3"><dt>Total</dt><dd className="font-semibold">{peso(result.total)}</dd></div>
        <div className="flex justify-between gap-3"><dt>Payment</dt><dd>Pending admin review</dd></div>
      </dl>
      <button type="button" onClick={async()=>{await navigator.clipboard.writeText(result.id);setCopied(true);}} className="min-h-11 rounded-lg border px-4 text-sm font-semibold">{copied?"Reference copied":"Copy order reference"}</button>
      <Link href={`/track-order?reference=${encodeURIComponent(result.id)}`} className="inline-flex min-h-11 items-center rounded-lg border px-5 text-sm font-semibold">Track this order</Link>
      <Link href="/shop" className="inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground">Continue shopping</Link>
    </section>
  );

  if(!ready)return <p role="status">Loading your cart…</p>;

  if (!chosen.length) return (
    <section className="rounded-2xl border bg-white px-5 py-12 text-center">
      <ShoppingBag className="mx-auto mb-4 size-10 text-primary/50" aria-hidden="true" />
      <h2 className="text-2xl">{lines.length?"Your cart needs attention":"Your order is empty"}</h2>{lines.length>0&&<Link href="/cart" className="mt-4 inline-block underline">Review unavailable items in your cart</Link>}
      <p className="mt-2 text-sm text-muted-foreground">Choose something you love from the shop to get started.</p>
      <Link href="/shop" className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground">Browse the shop</Link>
    </section>
  );

  return (
    <form onSubmit={e => {
      e.preventDefault();
      if (pending || cartInvalid) return;
      const data = new FormData(e.currentTarget);
      const input = {
        action: "order.guest" as const,
        contact: {
          name: String(data.get("name") ?? ""), email: String(data.get("email") ?? ""),
          phone: String(data.get("phone") ?? ""), address: String(data.get("address") ?? ""),
        },
        fulfillment,
        ...(fulfillment === "pickup" ? { pickupPayment } : {}),
        ...((fulfillment === "delivery" || pickupPayment === "online") && proofPath ? { proofPath } : {}),
        items: chosen.map(i => ({ variantId: i.id, quantity: quantities[i.id] ?? 0 })),
        promotionCode: String(data.get("promotionCode") ?? ""), notes: String(data.get("notes") ?? ""),
      };
      const payload = JSON.stringify(input);
      if (attempt.current?.payload !== payload) attempt.current = { payload, request: crypto.randomUUID() };
      const request = attempt.current.request;
      start(async () => {
        try { const response=await placeGuestOrder(request,input);if(response.ok)completeCartPurchase(input.items);setResult(response); }
        catch { setResult({ ok: false, error: "Couldn't connect. Please try again." }); }
      });
    }}>
      <fieldset disabled={pending} className="min-w-0 space-y-4 disabled:opacity-60">
        <legend className="sr-only">Your order and delivery details</legend>
        {cartInvalid&&<p role="alert" className="rounded-lg border p-3 text-sm text-destructive">Some items are unavailable or exceed available stock. <Link href="/cart" className="underline">Review your cart</Link> before submitting.</p>}
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
                    <select aria-label={`Quantity for ${item.name}, ${item.sku}`} value={quantities[item.id]} onChange={e => setCartQuantity(item.id,Number(e.target.value),item.available)} className="min-h-11 rounded-lg border bg-white px-3 text-base text-foreground focus-visible:ring-2 focus-visible:ring-primary">
                      {(quantities[item.id]??0)>item.available&&<option value={quantities[item.id]} disabled>{quantities[item.id]} (unavailable)</option>}{Array.from({ length: Math.min(10,item.available) }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                    </select>
                  </label>
                </div>
                <button type="button" aria-label={`Remove ${item.name}, ${item.sku}`} onClick={() => setCartQuantity(item.id,0,0)} className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"><Trash2 className="size-4" /></button>
              </li>
            ))}
          </ul>
          {remaining.length > 0 && chosen.length < 30 && (
            <details className="border-t pt-3 text-sm">
              <summary className="min-h-11 cursor-pointer py-3 font-medium text-primary">Add another item</summary>
              <label className="block pb-1"><span className="sr-only">Product to add</span>
                <select aria-label="Product to add" value="" onChange={e => { if (e.target.value) addCartItem(e.target.value,items.find(item=>item.id===e.target.value)?.available??0); }} className={field}>
                  <option value="">Choose a product</option>
                  {remaining.map(item => <option key={item.id} value={item.id}>{item.name} · {item.sku} · {peso(item.price)}</option>)}
                </select>
              </label>
            </details>
          )}
        </section>

        <section aria-labelledby="delivery-heading" className="space-y-4 rounded-2xl border bg-white p-4 sm:p-6">
          <h2 id="delivery-heading" className="font-sans text-lg font-semibold">Contact and fulfillment</h2>
          <fieldset className="flex flex-wrap gap-5 text-sm"><legend className="mb-2 font-medium">How would you like to receive your order?</legend>
            <label className="flex items-center gap-2"><input type="radio" name="fulfillment" checked={fulfillment === "delivery"} onChange={() => setFulfillment("delivery")}/>Delivery</label>
            <label className="flex items-center gap-2"><input type="radio" name="fulfillment" checked={fulfillment === "pickup"} onChange={() => setFulfillment("pickup")}/>Pickup</label>
          </fieldset>
          <label className="block text-sm font-medium">Full name<input name="name" autoComplete="name" required maxLength={160} className={field} /></label>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="min-w-0 text-sm font-medium">Phone number<input name="phone" type="tel" autoComplete="tel" required minLength={7} maxLength={40} className={field} /></label>
            <label className="min-w-0 text-sm font-medium">Email (optional)<input name="email" type="email" autoComplete="email" maxLength={254} className={field} /></label>
          </div>
          {fulfillment === "delivery" ? <label className="block text-sm font-medium">Delivery address<textarea name="address" autoComplete="street-address" required minLength={5} maxLength={1000} rows={2} placeholder="House / unit, street, barangay, city, province, postal code" className={field} /></label> : <fieldset className="space-y-2 text-sm"><legend className="font-medium">Pickup payment</legend>
            <label className="flex items-center gap-2"><input type="radio" checked={pickupPayment === "online"} onChange={() => setPickupPayment("online")}/>Pay online (upload proof)</label>
            <label className="flex items-center gap-2"><input type="radio" checked={pickupPayment === "upon_pickup"} onChange={() => setPickupPayment("upon_pickup")}/>Pay upon pickup (reserved for 1 day)</label>
          </fieldset>}
          {(fulfillment === "delivery" || pickupPayment === "online") && <label className="block text-sm font-medium">Proof of payment<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required onChange={async e => {
            const file=e.target.files?.[0]; if(!file)return; setUploading(true); setProofPath("");
            try { const body=new FormData(); body.set("proof",file); const response=await fetch("/api/checkout/payment-proof",{method:"POST",body}); const data=await response.json(); if(!response.ok) throw new Error(data.error); setProofPath(data.path); }
            catch { setProofPath(""); e.target.value=""; setResult({ok:false,error:"Proof upload failed. Please try again."}); }
            finally {setUploading(false);}
          }} className={field}/><span className="text-xs text-muted-foreground">{proofPath ? "Proof uploaded." : uploading ? "Uploading…" : "Upload your completed payment receipt."}</span></label>}
          {(fulfillment === "delivery" || pickupPayment === "online") && <section className="rounded-lg bg-muted p-4 text-sm"><h3 className="font-semibold">Where to pay</h3><p className="mt-2 whitespace-pre-wrap">{paymentInstructions||"Online payment instructions are not available. Please contact the store before submitting an order."}</p></section>}
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
            <div className="flex justify-between gap-3"><dt>{fulfillment === "delivery" ? "Delivery" : "Pickup"}</dt><dd>{peso(fulfillment === "delivery" ? shipping : 0)}</dd></div>
            <div className="flex justify-between gap-3 border-t pt-3 text-lg font-semibold"><dt>Total <span className="text-xs font-normal text-muted-foreground">before promo</span></dt><dd>{peso(subtotal + (fulfillment === "delivery" ? shipping : 0))}</dd></div>
          </dl>
          <p className="text-xs leading-relaxed text-muted-foreground">Your order awaits store confirmation. Pay-on-pickup reservations expire after 24 hours.</p>
          {result && !result.ok && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-destructive">{result.error}</p>}
          <button type="submit" disabled={pending || uploading || cartInvalid || !count || chosen.length > 30 || ((fulfillment === "delivery" || pickupPayment === "online") && !proofPath)} className="min-h-12 w-full rounded-lg bg-primary px-6 py-3 font-semibold text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50">{pending ? "Submitting…" : "Submit order for confirmation"}</button>
        </section>
      </fieldset>
    </form>
  );
}
