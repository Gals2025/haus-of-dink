import type { Metadata } from "next";
import Link from "next/link";
import { PackageOpen } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Shop" };

export default function ShopPage() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
      <Badge variant="outline">THE COLLECTION</Badge>
      <h1 className="mt-5 text-5xl font-semibold tracking-tight">
        Find your next favorite.
      </h1>
      <p className="mt-4 max-w-xl text-muted-foreground">
        Paddles and accessories for the way you play.
      </p>
      <div className="mt-12 rounded-2xl border border-dashed bg-card px-6 py-20 text-center">
        <PackageOpen
          aria-hidden="true"
          className="mx-auto size-12 text-primary"
          strokeWidth={1.5}
        />
        <h2 className="mt-5 text-2xl font-semibold">
          Our collection is warming up
        </h2>
        <p className="mx-auto mb-7 mt-3 max-w-md text-muted-foreground">
          Products will appear here in a future phase. This storefront preview
          does not accept purchases yet.
        </p>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Back to the haus
        </Link>
      </div>
    </div>
  );
}
