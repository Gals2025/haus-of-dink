import Link from "next/link";
import { Brand } from "@/components/layout/brand";

export function StorefrontHeader() {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-6 lg:px-10">
        <Brand />
        <nav aria-label="Storefront" className="flex gap-6 text-sm font-medium">
          <Link href="/" className="hover:text-primary">
            Home
          </Link>
          <Link href="/shop" className="hover:text-primary">
            Shop
          </Link>
          <Link href="/checkout" className="hover:text-primary">Guest checkout</Link>
        </nav>
      </div>
    </header>
  );
}
