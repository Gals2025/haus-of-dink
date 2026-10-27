import "server-only";
import type { SQL } from "drizzle-orm";
import { getPermissionSession } from "@/server/auth/authorize";
import { getDb } from "@/server/db";
import { productFilters, productId, errors, type Product, type ProductDetail, type ListResult, type DetailResult } from "./contracts";
import { listProductsQuery, productDetailQuery } from "./queries";

export type CatalogStorage = {
  authorize: typeof getPermissionSession;
  read: <T extends Record<string, unknown>>(query: SQL) => Promise<T[]>;
};
export function createCatalogReads(deps: CatalogStorage) {
  return {
    async listProducts(input: unknown = {}): Promise<ListResult> {
      try {
        const identity = await deps.authorize("inventory:read");
        if (!identity) return errors.FORBIDDEN;
        const parsed = productFilters.safeParse(input);
        if (!parsed.success) return errors.VALIDATION;
        const filters = parsed.data;
        const [row] = await deps.read<{ authorized: boolean; total: number; products: Product[] }>(listProductsQuery(identity, filters));
        if (!row?.authorized) return errors.FORBIDDEN;
        return { ok: true, products: row.products, total: row.total, page: filters.page, pageSize: filters.pageSize,
          totalPages: Math.ceil(row.total / filters.pageSize) };
      } catch { return errors.UNAVAILABLE; }
    },
    async getProductDetail(id: unknown): Promise<DetailResult> {
      try {
        const identity = await deps.authorize("inventory:read");
        if (!identity) return errors.FORBIDDEN;
        const parsed = productId.safeParse(id);
        if (!parsed.success) return errors.VALIDATION;
        const [row] = await deps.read<{ authorized: boolean; product: ProductDetail | null }>(productDetailQuery(identity, parsed.data));
        if (!row?.authorized) return errors.FORBIDDEN;
        return row.product ? { ok: true, product: row.product } : errors.NOT_FOUND;
      } catch { return errors.UNAVAILABLE; }
    },
  };
}
export const { listProducts, getProductDetail } = createCatalogReads({
  authorize: getPermissionSession,
  read: async <T extends Record<string, unknown>>(query: SQL) => (await getDb().execute<T>(query)).rows,
});

export { createProduct, updateProduct, archiveProduct, reactivateProduct } from "./mutations";
