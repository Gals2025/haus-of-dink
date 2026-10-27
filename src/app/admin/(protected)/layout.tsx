import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/authorize";
import {
  ArrowUpRight, BarChart3, Boxes, ClipboardList, History, LayoutDashboard,
  Megaphone, Package, Settings, Shapes, ShieldCheck, Tags, Users,
} from "lucide-react";
import { Brand } from "@/components/layout/brand";
import { AdminNavLink } from "@/components/layout/admin-nav-link";
import { Badge } from "@/components/ui/badge";
import { AdminSignOut } from "../sign-out";

const navigationGroups = [
  {
    label: "Sales & customers",
    items: [
      { href: "/admin/orders", label: "Orders", permission: "orders:read", icon: ClipboardList },
      { href: "/admin/customers", label: "Customers", permission: "customers:read", icon: Users },
    ],
  },
  {
    label: "Inventory & catalog",
    items: [
      { href: "/admin/inventory", label: "Inventory", permission: "inventory:read", icon: Boxes },
      { href: "/admin/products", label: "Products", permission: "inventory:read", icon: Package },
      { href: "/admin/variants", label: "Variant management", permission: "inventory:read", icon: Shapes },
      { href: "/admin/catalog", label: "Categories & brands", permission: "inventory:read", icon: Tags },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/admin/promotions", label: "Promotions", permission: "promotions:read", icon: Megaphone },
    ],
  },
  {
    label: "Reports",
    items: [
      { href: "/admin/reports", label: "Reports", permission: "reports:read", icon: BarChart3 },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/users", label: "People & access", permission: "users:read", icon: ShieldCheck },
      { href: "/admin/audit", label: "Access history", permission: "audit:read", icon: History },
      { href: "/admin/settings", label: "Store settings", permission: "settings:read", icon: Settings },
    ],
  },
] as const;

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const identity = await requirePermission("admin:access");
  const visibleGroups = navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => hasPermission(identity.staff.role, item.permission)),
    }))
    .filter((group) => group.items.length > 0);

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
          <nav aria-label="Admin" className="space-y-5">
            <AdminNavLink href="/admin">
              <LayoutDashboard aria-hidden="true" className="size-4 shrink-0" />
              Overview
            </AdminNavLink>
            {visibleGroups.map((group) => (
              <section key={group.label} aria-label={group.label}>
                <h2 className="mb-2 px-4 text-xs font-semibold tracking-wide text-muted-foreground">
                  {group.label}
                </h2>
                <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
                  {group.items.map(({ href, label, icon: Icon }) => (
                    <li key={href}>
                      <AdminNavLink href={href}>
                        <Icon aria-hidden="true" className="size-4 shrink-0" />
                        {label}
                      </AdminNavLink>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <Link
              href="/"
              className="flex items-center gap-3 border-t px-4 pt-5 pb-3 text-sm text-muted-foreground hover:bg-muted"
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

