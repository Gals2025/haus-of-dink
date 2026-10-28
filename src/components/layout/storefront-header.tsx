import Link from "next/link";
import { ArrowUpRight, Search, ShoppingBag } from "lucide-react";
import { Brand } from "@/components/layout/brand";

export function StorefrontHeader() {
  return (
    <header className="border-b border-border/70 bg-background/95">
      <div className="store-header mx-auto grid max-w-[1500px] items-center gap-5 px-5 py-5 sm:px-8 lg:grid-cols-[220px_minmax(260px,1fr)_auto_auto] lg:gap-8 lg:px-12">
        <Brand />
        <form action="/shop" role="search" className="store-search">
          <label className="sr-only" htmlFor="store-search">Search the shop</label>
          <input id="store-search" name="q" placeholder="Search paddles, accessories, and more…" />
          <button type="submit" aria-label="Search">
            <Search aria-hidden="true" className="size-6" />
          </button>
        </form>
        <Link href="/shop" className="shop-all">Shop all <ArrowUpRight aria-hidden="true" className="size-4" /></Link>
        <Link href="/checkout" className="checkout-link" aria-label="Checkout">
          <ShoppingBag aria-hidden="true" className="size-5" />
          <span>Checkout</span>
        </Link>
      </div>
    </header>
  );
}
