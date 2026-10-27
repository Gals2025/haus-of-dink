import Link from "next/link";
import { requirePermission } from "@/server/auth/authorize";
import { listProductOptions } from "@/server/catalog/service";
import { ProductForm } from "../product-form";

export default async function NewProductPage() {
  await requirePermission("inventory:write");
  const options = await listProductOptions();
  return <div className="space-y-6"><Link className="text-sm underline" href="/admin/products">Back to products</Link>
    <header><h1 className="text-4xl">Create product</h1><p className="mt-3 text-muted-foreground">Start with a draft, then add the product information.</p></header>
    {options.ok ? <ProductForm options={options} /> : <p role="alert">{options.error} Refresh to try again.</p>}
  </div>;
}
