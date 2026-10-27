import { connection } from "next/server";
import type { Metadata } from "next";
import { Suspense } from "react";
import { getShop } from "@/server/commerce/guest";
import { ShopCatalog } from "./shop-catalog";

export const metadata: Metadata = {
  title: "Shop pickleball paddles & accessories",
  description: "Explore pickleball paddles and court essentials at Haus of Dink. Browse by category, compare prices, and order without an account.",
};
async function Collection({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await connection();
  const [{ items }, params] = await Promise.all([getShop(), searchParams]);
  return <ShopCatalog key={typeof params.q === "string" ? params.q : ""} items={items} initialSearch={typeof params.q === "string" ? params.q.slice(0, 160) : ""} />;
}
export default function ShopPage(props: { searchParams: Promise<{ q?: string }> }) {
  return <div className="bg-[#f5f6f2] text-[#233421]">
    <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:px-10">
      <Suspense fallback={<div aria-label="Loading shop" role="status" className="space-y-6"><div className="h-56 animate-pulse rounded-2xl bg-secondary" /><p>Loading your court essentials…</p><div className="grid grid-cols-2 gap-4 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-72 animate-pulse rounded-xl bg-white" />)}</div></div>}><Collection {...props} /></Suspense>
    </div>
  </div>;
}
