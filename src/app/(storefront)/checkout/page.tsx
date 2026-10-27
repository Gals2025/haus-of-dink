import { connection } from "next/server";
import { Suspense } from "react";
import type { Metadata } from "next";
import { getShop } from "@/server/commerce/guest";
import { CheckoutForm } from "./checkout-form";
export const metadata: Metadata = { title: "Guest checkout" };
async function Checkout({ searchParams }: { searchParams: Promise<{ variant?: string }> }) {
  await connection();
  const [shop, params] = await Promise.all([getShop(), searchParams]);
  const selected = shop.items.find(i => i.id === params.variant && i.available > 0)?.id;
  return <CheckoutForm {...shop} selected={selected} />;
}
export default function CheckoutPage(props: { searchParams: Promise<{ variant?: string }> }) {
  return <div className="mx-auto max-w-4xl space-y-4 px-3 py-6 sm:space-y-6 sm:px-6 sm:py-12">
    <h1 className="text-3xl sm:text-4xl">Guest checkout</h1>
    <p className="text-muted-foreground">Order without signing in or creating an account. We use your contact details to process your order and arrange delivery.</p>
    <Suspense fallback={<p>Loading checkout…</p>}><Checkout {...props} /></Suspense>
  </div>;
}
