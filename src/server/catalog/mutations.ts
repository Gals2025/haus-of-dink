import "server-only";
import type { SQL } from "drizzle-orm";
import { getPermissionSession } from "@/server/auth/authorize";
import { managementLock } from "@/server/admin/queries";
import { getDb } from "@/server/db";
import { createProductInput, updateProductInput, productId, errors, type MutationResult } from "./contracts";
import { mutateProductQuery, type ProductAction } from "./mutation-queries";

type Outcome = { authorized: boolean; found: boolean; changed: boolean; validReferences?: boolean };
export type MutationStorage = {
  authorize: typeof getPermissionSession;
  // Must run managementLock FIRST, then query in the SAME READ COMMITTED transaction.
  change: (query: SQL) => Promise<Outcome | undefined>;
};
function databaseFailure(error: unknown): MutationResult {
  // Drizzle wraps driver errors. Inspect only SQLSTATE and constraint names;
  // never forward the error message, SQL, parameters or raw driver object.
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const e = current as { code?: string; constraint?: string; cause?: unknown };
    if (e.code === "23505" && e.constraint === "products_slug_unique") return errors.CONFLICT;
    if (e.code === "23503" && ["products_brand_id_brands_id_fk", "products_category_id_categories_id_fk"].includes(e.constraint ?? "")) return errors.REFERENCE;
    current = e.cause;
  }
  return errors.UNAVAILABLE;
}
export function createCatalogMutations(deps: MutationStorage) {
  async function mutate(action: ProductAction, id: unknown, input?: unknown): Promise<MutationResult> {
    try {
      const identity = await deps.authorize("inventory:write");
      if (!identity) return errors.FORBIDDEN;
      const parsedId = productId.safeParse(id);
      if (!parsedId.success) return errors.VALIDATION;
      const parsed = action === "create" ? createProductInput.safeParse(input)
        : action === "update" ? updateProductInput.safeParse(input) : { success: true as const, data: {} };
      if (!parsed.success) return errors.VALIDATION;
      const result = await deps.change(mutateProductQuery(identity, action, parsedId.data, parsed.data));
      if (!result?.authorized) return errors.FORBIDDEN;
      if (action !== "create" && !result.found) return errors.NOT_FOUND;
      if (result.validReferences === false) return { ...errors.REFERENCE, error: "Choose an active brand and category. Existing inactive selections can be retained." };
      if (action === "create" && !result.changed) return errors.UNAVAILABLE;
      return { ok: true, productId: parsedId.data, changed: result.changed };
    } catch (error) { return databaseFailure(error); }
  }
  return {
    createProduct: (input: unknown): Promise<MutationResult> => mutate("create", crypto.randomUUID(), input),
    updateProduct: (productId: unknown, input: unknown): Promise<MutationResult> => mutate("update", productId, input),
    archiveProduct: (productId: unknown): Promise<MutationResult> => mutate("archive", productId),
    reactivateProduct: (productId: unknown): Promise<MutationResult> => mutate("reactivate", productId),
  };
}
export const { createProduct, updateProduct, archiveProduct, reactivateProduct } = createCatalogMutations({
  authorize: getPermissionSession,
  change: async (query) => {
    const db = getDb();
    const [, result] = await db.batch([db.execute(managementLock), db.execute<Outcome>(query)]);
    return result.rows[0];
  },
});
