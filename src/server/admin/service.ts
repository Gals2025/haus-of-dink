import "server-only";
import { getPermissionSession, type Permission } from "@/server/auth/authorize";
import { getDb } from "@/server/db";
import { auditQuery, changeUserQuery, listUsersQuery, managementLock } from "./queries";
import { pageSize, userChange, userFilters, type ChangeResult, type ManagedUser } from "./contracts";

// A single entry point for actions and pages. No caller can supply an actor.
export function createUserManagement(deps: {
  authorize: typeof getPermissionSession;
  list: (query: ReturnType<typeof listUsersQuery>) => Promise<ManagedUser[]>;
  change: (query: ReturnType<typeof changeUserQuery>) => Promise<boolean>;
}) {
  return {
    async list(input: unknown) {
      const identity = await deps.authorize("users:read");
      if (!identity) throw new Error("Access denied.");
      const filters = userFilters.parse(input);
      const rows = await deps.list(listUsersQuery(identity, filters));
      return { users: rows.slice(0, pageSize), hasMore: rows.length > pageSize, filters };
    },
    async change(input: unknown): Promise<ChangeResult> {
      const parsed = userChange.safeParse(input);
      if (!parsed.success) return { ok: false, error: "Invalid account change. Refresh and try again." };
      const permission: Permission = parsed.data.kind === "role" ? "users:role" : "users:status";
      const identity = await deps.authorize(permission);
      if (!identity) return { ok: false, error: "Access denied. Sign in with an authorized account." };
      // The SQL statement repeats session, current role, active and target checks
      // AFTER the advisory lock. No preflight result authorizes a later write.
      const ok = await deps.change(changeUserQuery(identity, parsed.data));
      return ok ? { ok: true } : { ok: false, error: "Change denied or account changed. Refresh before trying again. You cannot change your own access." };
    },
  };
}

export const userManagement = createUserManagement({
  authorize: getPermissionSession,
  list: async (query) => (await getDb().execute<ManagedUser>(query)).rows,
  change: async (query) => {
    const db = getDb();
    const [, result] = await db.batch([db.execute(managementLock), db.execute<{ ok: boolean }>(query)]);
    return result.rows[0]?.ok === true;
  },
});

export async function listAudit() {
  const identity = await getPermissionSession("audit:read");
  if (!identity) throw new Error("Access denied.");
  return (await getDb().execute<{
    id: string; actorId: string; targetId: string; action: string;
    beforeRole: string; afterRole: string; beforeActive: boolean; afterActive: boolean; createdAt: string;
  }>(auditQuery(identity))).rows;
}
