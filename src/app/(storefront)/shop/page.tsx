import { connection } from "next/server";
import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { getShop } from "@/server/commerce/guest";
import { peso } from "@/server/commerce/contracts";
export const metadata: Metadata = { title: "Shop" };
async function Collection() {
  await connection();
  const { items } = await getShop();
  if (!items.length) return <p className="rounded-xl border p-8">Our collection is warming up. Check back soon.</p>;
  return <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map(item => <article key={item.id} className="space-y-3 rounded-2xl border bg-card p-6">
    <h2 className="text-xl">{item.name}</h2><p className="text-sm text-muted-foreground">{item.sku}</p>
    <p className="font-semibold">{peso(item.price)}</p>
    {item.available > 0 ? <Link href={`/checkout?variant=${item.id}`} className="inline-block rounded-lg bg-primary px-4 py-2 text-primary-foreground">Order as guest</Link> : <p className="text-muted-foreground">Out of stock</p>}
  </article>)}</div>;
}
export default function ShopPage() {
  return <div className="mx-auto max-w-7xl space-y-8 px-6 py-16 lg:px-10">
    <h1 className="text-5xl">Find your next favorite.</h1>
    <p className="text-muted-foreground">Paddles and accessories for the way you play. Checkout without an account.</p>
    <Suspense fallback={<p>Loading collection…</p>}><Collection /></Suspense>
  </div>;
}
