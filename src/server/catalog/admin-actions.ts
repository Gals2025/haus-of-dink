import "server-only";
import { getPermissionSession } from "@/server/auth/authorize";
import { createProduct, updateProduct, archiveProduct, reactivateProduct } from "./mutations";
import { errors, type MutationResult } from "./contracts";

// The action boundary authorizes independently of page visibility. Services
// repeat authorization and the database statement rechecks current identity.
export function createProductAdminActions(deps: {
  authorize: typeof getPermissionSession;
  create: typeof createProduct; update: typeof updateProduct;
  archive: typeof archiveProduct; reactivate: typeof reactivateProduct;
  refresh: (id: string) => void;
}) {
  async function run(operation: () => Promise<MutationResult>): Promise<MutationResult> {
    let result: MutationResult;
    try {
      if (!await deps.authorize("inventory:write")) return errors.FORBIDDEN;
      result = await operation();
    } catch { return errors.UNAVAILABLE; }
    // A refresh failure must not report a committed write as failed and invite
    // a duplicate create. The client navigates/refreshes after successful saves.
    if (result.ok) { try { deps.refresh(result.productId); } catch { /* write already confirmed */ } }
    return result;
  }
  return {
    create: (input: unknown) => run(() => deps.create(input)),
    update: (id: unknown, input: unknown) => run(() => deps.update(id, input)),
    archive: (id: unknown) => run(() => deps.archive(id)),
    reactivate: (id: unknown) => run(() => deps.reactivate(id)),
  };
}
