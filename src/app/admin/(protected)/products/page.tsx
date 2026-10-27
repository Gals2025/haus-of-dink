import Link from "next/link";
import { requirePermission, hasPermission } from "@/server/auth/authorize";
import { listProducts, listProductOptions } from "@/server/catalog/service";
import { parseProductSearch, productPageHref } from "@/server/catalog/admin-input";

const control = "mt-1 block w-full rounded-md border bg-background p-2";
export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const identity = await requirePermission("inventory:read");
  const params = await searchParams;
  const parsed = parseProductSearch(params);
  const [result, options] = await Promise.all([listProducts(parsed.success ? parsed.data : {}), listProductOptions()]);
  if (!result.ok) return <div role="alert"><h1 className="text-3xl">Products unavailable</h1><p className="mt-3">{result.error}</p><Link className="mt-4 inline-block underline" href="/admin/products">Try again</Link></div>;
  const filters = parsed.success ? parsed.data : { search: "", status: undefined, brandId: undefined, categoryId: undefined, featured: undefined, newArrival: undefined, sort: "newest" };
  const canWrite = hasPermission(identity.staff.role, "inventory:write");
  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs tracking-widest text-primary">HAUS OF DINK / CATALOG</p>
      <h1 className="mt-3 text-4xl">Products</h1><p className="mt-3 text-muted-foreground">Manage your catalog. Stock quantities remain in Inventory.</p></div>
      {canWrite && <Link href="/admin/products/new" className="rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground">Create product</Link>}</header>
    {!parsed.success && <p role="alert" className="text-sm text-destructive">Invalid filters. Showing the first page with default filters.</p>}
    {!options.ok && <p role="alert" className="text-sm text-destructive">Brand and category filters are temporarily unavailable.</p>}
    <form action="/admin/products" className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 xl:grid-cols-4">
      <label className="text-sm sm:col-span-2">Search name or slug<input name="search" defaultValue={filters.search} maxLength={240} className={control} /></label>
      <label className="text-sm">Status<select name="status" defaultValue={filters.status ?? ""} className={control}><option value="">All statuses</option><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select></label>
      <label className="text-sm">Sort<select name="sort" defaultValue={filters.sort} className={control}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name_asc">Name A–Z</option><option value="name_desc">Name Z–A</option></select></label>
      <label className="text-sm">Brand<select name="brandId" defaultValue={filters.brandId ?? ""} disabled={!options.ok} className={control}><option value="">All brands</option>{options.ok && options.brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.status !== "active" ? " (inactive)" : ""}</option>)}</select></label>
      <label className="text-sm">Category<select name="categoryId" defaultValue={filters.categoryId ?? ""} disabled={!options.ok} className={control}><option value="">All categories</option>{options.ok && options.categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.status !== "active" ? " (inactive)" : ""}</option>)}</select></label>
      <label className="text-sm">Featured<select name="featured" defaultValue={filters.featured === undefined ? "" : String(filters.featured)} className={control}><option value="">All products</option><option value="true">Featured</option><option value="false">Not featured</option></select></label>
      <label className="text-sm">New arrival<select name="newArrival" defaultValue={filters.newArrival === undefined ? "" : String(filters.newArrival)} className={control}><option value="">All products</option><option value="true">New arrivals</option><option value="false">Other products</option></select></label>
      <div className="flex items-center gap-4 sm:col-span-2"><button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Apply filters</button><Link className="text-sm underline" href="/admin/products">Reset</Link></div>
    </form>
    <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full text-left text-sm"><caption className="sr-only">Product catalog</caption>
      <thead className="border-b bg-muted/50"><tr>{["Product", "Brand / category", "Status", "Flags", "Actions"].map((heading) => <th key={heading} scope="col" className="p-4">{heading}</th>)}</tr></thead>
      <tbody>{result.products.map((p) => <tr key={p.id} className="border-b last:border-0">
        <td className="p-4"><Link className="font-medium underline underline-offset-4" href={`/admin/products/${p.id}`}>{p.name}</Link><p className="mt-1 text-xs text-muted-foreground">{p.slug}</p></td>
        <td className="p-4">{options.ok ? <>{options.brands.find((b) => b.id === p.brandId)?.name ?? "Unavailable"}<p className="mt-1 text-xs text-muted-foreground">{options.categories.find((c) => c.id === p.categoryId)?.name ?? "Unavailable"}</p></> : "Unavailable"}</td>
        <td className="p-4"><span className="rounded-full bg-muted px-3 py-1 capitalize">{p.status}</span></td>
        <td className="p-4">{[p.featured && "Featured", p.newArrival && "New arrival"].filter(Boolean).join(" · ") || "—"}</td>
        <td className="p-4"><Link aria-label={`View ${p.name}`} className="underline" href={`/admin/products/${p.id}`}>View</Link>{canWrite && <Link aria-label={`Edit ${p.name}`} className="ml-4 underline" href={`/admin/products/${p.id}/edit`}>Edit</Link>}</td>
      </tr>)}{!result.products.length && <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No matching products. Change your filters{canWrite ? " or create a product" : ""}.</td></tr>}</tbody>
    </table></div>
    <nav aria-label="Product pages" className="flex flex-wrap items-center gap-4 text-sm">
      {result.page > 1 && <Link className="underline" href={productPageHref(parsed.success ? params : {}, result.page - 1)}>Previous</Link>}
      <span>{result.total} products · Page {result.page} of {Math.max(1, result.totalPages)}</span>
      {result.page < result.totalPages && <Link className="underline" href={productPageHref(params, result.page + 1)}>Next</Link>}
    </nav>
  </div>;
}
