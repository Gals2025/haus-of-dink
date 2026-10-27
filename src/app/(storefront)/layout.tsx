import { Suspense } from "react";
import { StoreContact } from "@/components/layout/store-contact";
import { StorefrontHeader } from "@/components/layout/storefront-header";

export default function StorefrontLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:p-4">
        Skip to content
      </a>
      <div className="bg-primary px-6 py-2 text-center text-xs font-medium tracking-widest text-primary-foreground">
        HAUS OF DINK · PICKLEBALL ESSENTIALS
      </div>
      <StorefrontHeader />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <footer className="border-t px-6 py-7 text-sm text-muted-foreground">
        <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-3">
          <Suspense fallback={<span className="font-serif text-xl text-primary">Haus of Dink</span>}><StoreContact /></Suspense>
          <span>Made for the court. Built for the community.</span>
        </div>
      </footer>
    </div>
  );
}

