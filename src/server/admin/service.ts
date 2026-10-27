import "server-only";
import { hashPassword } from "better-auth/crypto";
import { getPermissionSession, type Permission } from "@/server/auth/authorize";
import { getDb } from "@/server/db";
import { auditQuery, changeUserQuery, createUserQuery, listUsersQuery, managementLock } from "./queries";
import { pageSize, userCreate, userChange, userFilters, type ChangeResult, type ManagedUser } from "./contracts";

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
    async create(input: unknown): Promise<ChangeResult> {
      const identity = await deps.authorize("users:create");
      if (!identity) return { ok: false, error: "Access denied." };
      const parsed = userCreate.safeParse(input);
      if (!parsed.success) return { ok: false, error: "Enter a name, valid email, role and a password of 12–128 characters." };
      const hashed = await hashPassword(parsed.data.password);
      const ok = await deps.change(createUserQuery(identity, parsed.data, hashed));
      return ok ? { ok: true } : { ok: false, error: "Account could not be created. Check for an existing email or refresh your session." };
    },
    async change(input: unknown): Promise<ChangeResult> {
      const parsed = userChange.safeParse(input);
      if (!parsed.success) return { ok: false, error: "Invalid account change. Refresh and try again." };
      const permission: Permission = { role: "users:role", status: "users:status", profile: "users:update", delete: "users:delete" }[parsed.data.kind] as Permission;
      const identity = await deps.authorize(permission);
      if (!identity) return { ok: false, error: "Access denied. Sign in with an authorized account." };
      // The SQL statement repeats session, current role, active and target checks
      // AFTER the advisory lock. No preflight result authorizes a later write.
      const ok = await deps.change(changeUserQuery(identity, parsed.data));
      return ok ? { ok: true } : { ok: false, error: "Change denied, duplicate email, or account changed. Refresh and retry. Your own account is protected; accounts with inventory history must be deactivated instead." };
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
