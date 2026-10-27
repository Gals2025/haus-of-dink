import Link from "next/link";
import { requirePermission } from "@/server/auth/authorize";
import { listVariants } from "@/server/catalog/variant-reads";
export default async function VariantsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("inventory:read");
  const query = await searchParams;
  const search = typeof query.search === "string" ? query.search : "";
  const status = typeof query.status === "string" ? query.status : "";
  const result = await listVariants({ search, status, page: query.page ?? 1 });
  const href = (page: number) => `/admin/variants?${new URLSearchParams({ search, status, page: String(page) })}`;
  return <div className="space-y-6"><header><h1 className="text-4xl">Variant management</h1><p className="mt-3 text-muted-foreground">Find SKUs across products. Open a product to add or edit variants, prices and options.</p></header>
    <Link href="/admin/catalog" className="inline-block underline">Manage attributes and values</Link>
    <form className="flex flex-wrap items-end gap-4"><label className="text-sm">Search product or SKU<input name="search" maxLength={240} defaultValue={search} className="mt-1 block rounded-md border p-2" /></label><label className="text-sm">Status<select name="status" defaultValue={status} className="mt-1 block rounded-md border p-2"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label><button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Search</button><Link className="underline" href="/admin/variants">Reset</Link></form>
    {!result.ok ? <p role="alert">{result.error}</p> : <><div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><caption className="sr-only">Product variants</caption><thead className="bg-muted"><tr>{["Product / SKU", "Options", "Price", "Unit cost", "Status", "Actions"].map((h) => <th scope="col" key={h} className="p-4">{h}</th>)}</tr></thead><tbody>{result.rows.map((v) => <tr key={v.id} className="border-t"><td className="p-4">{v.productName}<p className="text-muted-foreground">{v.sku}</p></td><td className="p-4">{v.options || "—"}</td><td className="p-4">{v.currency} {(v.price / 100).toFixed(2)}</td><td className="p-4">{v.cost === null ? "—" : `${v.currency} ${(v.cost / 100).toFixed(2)}`}</td><td className="p-4 capitalize">{v.status}</td><td className="p-4"><Link className="underline" href={`/admin/products/${v.productId}`}>Open product</Link></td></tr>)}{!result.rows.length && <tr><td colSpan={6} className="p-6 text-center">No matching variants.</td></tr>}</tbody></table></div><nav aria-label="Variant pages" className="flex gap-4 text-sm">{result.page > 1 && <Link className="underline" href={href(result.page - 1)}>Previous</Link>}<span>{result.total} variants · Page {result.page} of {Math.max(1, Math.ceil(result.total / 20))}</span>{result.page * 20 < result.total && <Link className="underline" href={href(result.page + 1)}>Next</Link>}</nav></>}
  </div>;
}
