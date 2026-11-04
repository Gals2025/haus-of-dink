import type { PosProduct } from "@/server/pos/contracts";

export function filterPosProducts(products: PosProduct[], filters: { search: string; categoryId: string; brandId: string }) {
  const needle = filters.search.trim().toLowerCase();
  return products.filter(product =>
    (!filters.categoryId || product.categoryId === filters.categoryId) &&
    (!filters.brandId || product.brandId === filters.brandId) &&
    (!needle || [product.name, product.sku, product.barcode ?? ""].some(value => value.toLowerCase().includes(needle)))
  );
}
