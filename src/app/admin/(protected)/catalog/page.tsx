import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/authorize";
import { catalogManagement } from "@/server/catalog/management";
import { CatalogManager } from "./catalog-manager";

export default async function CatalogPage() {
  const identity = await requirePermission("inventory:read");
  const result = await catalogManagement.list();
  if (!result.ok) return <p role="alert">{result.error}</p>;
  return <div className="space-y-6">
    <header><h1 className="text-4xl">Categories &amp; brands</h1><p className="mt-3 text-muted-foreground">Organize products, maintain brands, and define color, size and other variant options.</p></header>
    <Link className="inline-block underline" href="/admin/catalog/history">Catalog change history</Link>
    <CatalogManager data={result} canWrite={hasPermission(identity.staff.role, "inventory:write")} />
  </div>;
}
