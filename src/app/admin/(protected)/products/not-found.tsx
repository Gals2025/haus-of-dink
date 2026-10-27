import Link from "next/link";
export default function ProductNotFound() { return <div className="space-y-4"><h1 className="text-3xl">Product not found</h1><p>The product identifier is invalid or the product no longer exists.</p><Link className="underline" href="/admin/products">Back to products</Link></div>; }
