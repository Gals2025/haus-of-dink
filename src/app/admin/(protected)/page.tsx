import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/authorize";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const commerceModules = [
  { title: "Orders & customers", description: "Record orders, track payments and fulfillment, and manage customer contacts.", href: "/admin/orders", permission: "orders:read" },
  { title: "Promotions & reports", description: "Manage discount codes and review fulfilled sales and daily totals.", href: "/admin/promotions", permission: "promotions:read" },
  { title: "Store settings", description: "Maintain business details and the shipping fee for new orders.", href: "/admin/settings", permission: "settings:read" },
];

export default async function AdminPage() {
  const identity = await requirePermission("dashboard:read");
  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-medium tracking-widest text-primary">
          HAUS OF DINK / WORKSPACE
        </p>
        <h1 className="mt-3 text-4xl font-normal tracking-tight">
          Store workspace
        </h1>
        <p className="mt-3 text-muted-foreground">
          Manage your product catalog, inventory and team.
        </p>
      </div>
      {hasPermission(identity.staff.role, "inventory:read") && <Card><CardHeader><CardTitle>Product catalog</CardTitle><CardDescription>Browse products and review their details, variants and images.</CardDescription></CardHeader><CardContent><Link href="/admin/products" className="inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Open products</Link></CardContent></Card>}
      {hasPermission(identity.staff.role, "inventory:read") && <Card><CardHeader><CardTitle>Stockroom</CardTitle><CardDescription>View available stock, record receipts and adjustments, and follow movement history.</CardDescription></CardHeader><CardContent><Link href="/admin/inventory" className="inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Open inventory</Link></CardContent></Card>}
      {hasPermission(identity.staff.role, "inventory:read") && <div className="grid gap-4 md:grid-cols-2"><Card><CardHeader><CardTitle>Variant management</CardTitle><CardDescription>Maintain SKUs, pricing, status and color or size options.</CardDescription></CardHeader><CardContent><Link className="underline" href="/admin/variants">Open variants</Link></CardContent></Card><Card><CardHeader><CardTitle>Categories &amp; brands</CardTitle><CardDescription>Manage categories, brands and variant attributes.</CardDescription></CardHeader><CardContent><Link className="underline" href="/admin/catalog">Open catalog settings</Link></CardContent></Card></div>}
      <section aria-labelledby="modules-heading">
        <h2 id="modules-heading" className="mb-4 text-xl font-normal">
          Store operations
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {commerceModules.filter(module => hasPermission(identity.staff.role, module.permission)).map((module) => (
            <Card key={module.href}>
              <CardHeader>
                <CardTitle className="text-base">{module.title}</CardTitle>
                <CardDescription>{module.description}</CardDescription>
              </CardHeader>
              <CardContent><Link className="underline" href={module.href}>Open {module.title.toLowerCase()}</Link></CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

