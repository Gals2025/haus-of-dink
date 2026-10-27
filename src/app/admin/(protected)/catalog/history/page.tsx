import Link from "next/link";
import { requirePermission } from "@/server/auth/authorize";
import { catalogManagement } from "@/server/catalog/management";
export default async function CatalogHistoryPage() {
  await requirePermission("inventory:read");
  const result = await catalogManagement.history();
  return <div className="space-y-5"><Link href="/admin/catalog" className="underline">Back to categories &amp; brands</Link><h1 className="text-3xl">Catalog change history</h1><p className="text-sm text-muted-foreground">Latest 100 changes to brands, categories, attributes and values. Variant changes are recorded with their product.</p>
    {!result.ok ? <p role="alert">{result.error}</p> : <ol className="space-y-3">{result.entries.map((e) => <li key={e.id} className="rounded-lg border bg-card p-4 text-sm"><p className="font-medium capitalize">{e.entityType} {e.action}: {String(e.changes.name ?? e.entityId)}</p><p className="text-muted-foreground">{new Date(e.createdAt).toISOString()}</p><details className="mt-2"><summary className="cursor-pointer">Change details</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(e.changes, null, 2)}</pre></details></li>)}{!result.entries.length && <li>No catalog changes recorded yet.</li>}</ol>}</div>;
}
