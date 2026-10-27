import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { getPermissionSession } from "@/server/auth/authorize";
import { managementLock } from "@/server/admin/queries";
import { getDb } from "@/server/db";
import { errors } from "./contracts";
import { catalogActor } from "./queries";
import { createOptionInput, optionKind, type CatalogOption, type OptionResult } from "./option-contracts";

type Outcome = { authorized: boolean; option: CatalogOption | null };
export function createOptionMutations(deps: {
  authorize: typeof getPermissionSession;
  // Lock and write must share a READ COMMITTED transaction, as for products.
  change: (query: SQL) => Promise<Outcome | undefined>;
}) {
  return async function createOption(kind: unknown, input: unknown): Promise<OptionResult> {
    try {
      const identity = await deps.authorize("inventory:write");
      if (!identity) return errors.FORBIDDEN;
      const parsedKind = optionKind.safeParse(kind);
      const parsed = createOptionInput.safeParse(input);
      if (!parsedKind.success || !parsed.success) return { ...errors.VALIDATION, error: "Enter a name and a valid slug for the brand or category." };
      const table = sql.identifier(parsedKind.data === "brand" ? "brands" : "categories");
      const result = await deps.change(sql`with actor as materialized (${catalogActor(identity, "inventory:write", true)}),
        created as (insert into ${table} (name, slug)
          select ${parsed.data.name}, ${parsed.data.slug} from actor returning id, name, status)
        select exists(select 1 from actor) as authorized,
          (select jsonb_build_object('id', id, 'name', name, 'status', status) from created) as option`);
      if (!result?.authorized) return errors.FORBIDDEN;
      return result.option ? { ok: true, option: result.option } : errors.UNAVAILABLE;
    } catch (error) {
      let current = error;
      for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
        const e = current as { code?: string; constraint?: string; cause?: unknown };
        if (e.code === "23505" && ["brands_slug_unique", "brands_name_ci_unique", "categories_slug_unique"].includes(e.constraint ?? "")) {
          return { ...errors.CONFLICT, error: "That brand or category name or slug is already in use." };
        }
        current = e.cause;
      }
      return errors.UNAVAILABLE;
    }
  };
}
export const createCatalogOption = createOptionMutations({
  authorize: getPermissionSession,
  change: async (query) => {
    const db = getDb();
    const [, result] = await db.batch([db.execute(managementLock), db.execute<Outcome>(query)]);
    return result.rows[0];
  },
});
