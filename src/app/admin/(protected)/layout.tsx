import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/authorize";
import { ArrowUpRight, LayoutDashboard } from "lucide-react";
import { Brand } from "@/components/layout/brand";
import { AdminNavLink } from "@/components/layout/admin-nav-link";
import { Badge } from "@/components/ui/badge";
import { AdminSignOut } from "../sign-out";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const identity = await requirePermission("admin:access");
  return (
    <div className="min-h-screen bg-muted/40">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:p-4">
        Skip to content
      </a>
      <header className="flex flex-wrap items-center justify-between gap-4 border-b bg-background px-6 py-5">
        <Brand />
        <div className="flex items-center gap-3"><Badge variant="outline">ADMIN PREVIEW</Badge><AdminSignOut /></div>
      </header>
      <div className="mx-auto grid max-w-[1500px] lg:min-h-[calc(100vh-77px)] lg:grid-cols-[240px_1fr]">
        <aside className="border-b bg-background p-6 lg:border-r lg:border-b-0">
          <p className="mb-4 text-xs font-medium tracking-widest text-muted-foreground">
            WORKSPACE
          </p>
          <nav aria-label="Admin" className="flex flex-wrap gap-2 lg:flex-col">
            <AdminNavLink href="/admin">
              <LayoutDashboard aria-hidden="true" className="size-4" />
              Overview
            </AdminNavLink>
            {hasPermission(identity.staff.role, "inventory:read") && <AdminNavLink href="/admin/inventory">Inventory</AdminNavLink>}
            {hasPermission(identity.staff.role, "users:read") && <AdminNavLink href="/admin/users">People & access</AdminNavLink>}
            {hasPermission(identity.staff.role, "audit:read") && <AdminNavLink href="/admin/audit">Access history</AdminNavLink>}
            <Link
              href="/"
              className="flex items-center gap-3 rounded-lg px-4 py-3 text-sm text-muted-foreground hover:bg-muted"
            >
              View storefront
              <ArrowUpRight aria-hidden="true" className="size-4" />
            </Link>
          </nav>
        </aside>
        <main id="main-content" className="min-w-0 p-6 lg:p-10">
          {children}
        </main>
      </div>
    </div>
  );
}

