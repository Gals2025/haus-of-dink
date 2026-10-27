import { productFilters, type ProductInput, type ProductPatch } from "./contracts";

export function parseProductSearch(params: Record<string, string | string[] | undefined>) {
  const flag = (value: string | string[] | undefined) => value === undefined || value === "" ? undefined
    : value === "true" ? true : value === "false" ? false : value;
  return productFilters.safeParse({ search: params.search, page: params.page === undefined ? undefined : Array.isArray(params.page) ? params.page : Number(params.page),
    status: params.status || undefined, brandId: params.brandId || undefined, categoryId: params.categoryId || undefined,
    featured: flag(params.featured), newArrival: flag(params.newArrival), sort: params.sort || undefined });
}
export function productPageHref(params: Record<string, string | string[] | undefined>, page: number) {
  const query = new URLSearchParams();
  for (const key of ["search", "status", "brandId", "categoryId", "featured", "newArrival", "sort"]) {
    const value = params[key]; if (typeof value === "string" && value) query.set(key, value);
  }
  query.set("page", String(page)); return `/admin/products?${query}`;
}
export function changedProductFields(initial: ProductInput, current: ProductInput): ProductPatch {
  return Object.fromEntries(Object.entries(current).filter(([key, value]) => value !== initial[key as keyof ProductInput])) as ProductPatch;
}
