import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/server/auth/authorize";
import { getProductDetail, listProductOptions } from "@/server/catalog/service";
import { ProductForm } from "../../product-form";

export default async function EditProductPage({ params }: { params: Promise<{ productId: string }> }) {
  await requirePermission("inventory:write");
  const { productId } = await params;
  const [result, options] = await Promise.all([getProductDetail(productId), listProductOptions()]);
  if (!result.ok) {
    if (result.code === "NOT_FOUND" || result.code === "VALIDATION") notFound();
    return <p role="alert">{result.error}</p>;
  }
  return <div className="space-y-6"><Link className="text-sm underline" href={`/admin/products/${result.product.id}`}>Back to product</Link>
    <header><h1 className="text-4xl">Edit product</h1><p className="mt-3 text-muted-foreground">{result.product.name}</p></header>
    {options.ok ? <ProductForm key={result.product.updatedAt} product={result.product} options={options} /> : <p role="alert">{options.error} Refresh to try again.</p>}
  </div>;
}
