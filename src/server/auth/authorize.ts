import "server-only";
import { and, eq, gt, inArray, type SQL } from "drizzle-orm";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { user, session as sessions } from "@/server/db/schema";

export const permissions = ["admin:access", "dashboard:read", "session:read", "super_admin:access", "users:read", "users:role", "users:status", "users:privileged", "audit:read", "inventory:read", "inventory:write", "inventory:reserve", "inventory:sell"] as const;
export type Permission = (typeof permissions)[number];
export type StaffRole = "staff" | "admin" | "super_admin";

// Only implemented operations are granted. Future mutations need new permissions.
export const rolePermissions: Readonly<Record<StaffRole, readonly Permission[]>> = Object.freeze({
  staff: Object.freeze(["admin:access", "dashboard:read", "session:read", "inventory:read"] as const),
  admin: Object.freeze(["admin:access", "dashboard:read", "session:read", "users:read", "users:status", "inventory:read", "inventory:write", "inventory:reserve", "inventory:sell"] as const),
  super_admin: Object.freeze([...permissions]),
});

export function isStaffRole(role: string): role is StaffRole {
  return Object.hasOwn(rolePermissions, role);
}

/** Policy predicate only; request authorization must also resolve current identity. */
export function hasPermission(role: string, permission: string): boolean {
  return isStaffRole(role) && rolePermissions[role].some((allowed) => allowed === permission);
}

export type AuthSession = ReturnType<typeof getAuth>["$Infer"]["Session"];
type Staff = { id: string; active: boolean; role: string };

/** Shared query predicates keep the session/user binding and expiry check atomic. */
export function currentStaffSessionConditions(identity: AuthSession, now: Date | SQL = new Date()) {
  return and(
    eq(sessions.id, identity.session.id),
    eq(sessions.token, identity.session.token),
    eq(sessions.userId, identity.user.id),
    gt(sessions.expiresAt, now),
    eq(user.active, true),
  );
}

/** Dependency seam for isolated tests; production callers use the exports below. */
export function createAuthorization(deps: {
  redirect: (path: string) => never | Promise<never>;
  readSession: () => Promise<AuthSession | null>;
  findStaff: (identity: AuthSession) => Promise<Staff | undefined>;
}) {
  async function getStaffSession() {
    const identity = await deps.readSession();
    if (!identity || identity.session.userId !== identity.user.id ||
      !(identity.session.expiresAt.getTime() > Date.now())) return null;
    const staff = await deps.findStaff(identity);
    if (!staff?.active || staff.id !== identity.user.id || !isStaffRole(staff.role)) return null;
    return { ...identity, staff: { ...staff, role: staff.role } };
  }

  async function getPermissionSession(permission: Permission) {
    const identity = await getStaffSession();
    return identity && hasPermission(identity.staff.role, permission) ? identity : null;
  }

  async function requirePermission(permission: Permission) {
    const identity = await getStaffSession();
    if (!identity) return deps.redirect("/admin/login");
    if (!hasPermission(identity.staff.role, permission)) return deps.redirect("/admin");
    return identity;
  }

  async function requireStaff() {
    return requirePermission("admin:access");
  }

  async function requireSuperAdmin() {
    return requirePermission("super_admin:access");
  }

  return { getStaffSession, getPermissionSession, requirePermission, requireStaff, requireSuperAdmin };
}

export const { getStaffSession, getPermissionSession, requirePermission, requireStaff, requireSuperAdmin } = createAuthorization({
  redirect: async (path) => {
    const { redirect } = await import("next/navigation");
    return redirect(path);
  },
  readSession: async () => {
    const { headers } = await import("next/headers");
    // Establish the request-time boundary before reading runtime configuration.
    const requestHeaders = await headers();
    return getAuth().api.getSession({ headers: requestHeaders, query: { disableCookieCache: true } });
  },
  findStaff: async (identity) => {
    // No React cache, cookie claims, or cross-request memoization at this boundary.
    const [staff] = await getDb().select({ id: user.id, active: user.active, role: user.role })
      .from(sessions).innerJoin(user, eq(user.id, sessions.userId))
      .where(currentStaffSessionConditions(identity)).limit(1);
    return staff;
  },
});

/** Reuse the same policy at the database statement boundary, after write locks. */
export function currentPermissionSessionConditions(identity: AuthSession, permission: Permission, now: Date | SQL = new Date()) {
  const roles = (Object.keys(rolePermissions) as StaffRole[]).filter((role) => hasPermission(role, permission));
  return and(currentStaffSessionConditions(identity, now), inArray(user.role, roles));
}
