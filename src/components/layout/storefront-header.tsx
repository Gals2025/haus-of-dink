import Link from "next/link";
import { ArrowUpRight, Search, ShoppingBag } from "lucide-react";
import { Brand } from "@/components/layout/brand";

export function StorefrontHeader() {
  return <header className="border-b border-border bg-background">
    <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto] items-center gap-x-2 gap-y-3 px-3 py-3 sm:gap-x-5 sm:px-6 sm:py-5 lg:grid-cols-[auto_1fr_auto] lg:px-10">
      <Brand />
      <form action="/shop" role="search" className="order-3 col-span-2 flex overflow-hidden rounded-lg border border-primary/30 bg-white focus-within:ring-2 focus-within:ring-primary lg:order-none lg:col-span-1 lg:mx-6">
        <label htmlFor="store-search" className="sr-only">Search the shop</label><input id="store-search" name="q" type="search" maxLength={160} placeholder="Search paddles, accessories, and more…" className="min-w-0 flex-1 bg-transparent px-3 py-3 text-base outline-none sm:px-4 sm:text-sm" /><button type="submit" aria-label="Search shop" className="m-1 min-h-11 rounded-md bg-primary px-4 text-primary-foreground hover:bg-primary/90"><Search className="size-5" /></button>
      </form>
      <nav aria-label="Storefront" className="flex items-center gap-2 text-xs font-medium sm:text-sm"><Link href="/shop" className="hidden items-center gap-1 hover:text-primary sm:flex">Shop all <ArrowUpRight className="size-3.5" /></Link><Link href="/checkout" className="flex items-center gap-2 rounded-lg border border-primary/25 px-3 py-2.5 hover:bg-secondary"><ShoppingBag className="size-4 shrink-0" /><span>Checkout</span></Link></nav>
    </div>
  </header>;
}
