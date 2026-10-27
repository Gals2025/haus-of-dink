import "server-only";
import type { z } from "zod";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { currentPermissionSessionConditions, hasPermission, type AuthSession } from "@/server/auth/authorize";
import { user, session } from "@/server/db/schema";
import { pageSize, type UserFilters, type UserChange, userCreate } from "./contracts";

// All administrative writers must take this transaction-scoped lock FIRST, in a
// separate statement. The next READ COMMITTED statement gets a fresh snapshot.
// A lock inside the mutation's CTE would use a snapshot from before waiting.
export const managementLock = sql`select pg_advisory_xact_lock(1948401, 3)`;

export function listUsersQuery(identity: AuthSession, filters: UserFilters) {
  const search = `%${filters.search.replace(/[\\%_]/g, "\\$&")}%`;
  return sql`select id, name, email, role, active from "user"
    where exists (select 1 from ${session} inner join ${user} on ${user.id} = ${session.userId}
      where ${currentPermissionSessionConditions(identity, "users:read", sql`clock_timestamp()`)})
    and ${and(
      filters.search ? or(ilike(user.name, search), ilike(user.email, search)) : undefined,
      filters.role !== "all" ? eq(user.role, filters.role) : undefined,
      filters.status !== "all" ? eq(user.active, filters.status === "active") : undefined,
    ) ?? sql`true`}
    order by lower(name), id limit ${pageSize + 1} offset ${(filters.page - 1) * pageSize}`;
}

export function changeUserQuery(identity: AuthSession, change: UserChange) {
  if (change.kind === "profile" || change.kind === "delete") return profileOrDeleteQuery(identity, change);
  const permission = change.kind === "role" ? "users:role" : "users:status";
  const privilegedRoles = ["staff", "admin", "super_admin"].filter((role) => hasPermission(role, "users:privileged"));
  const newRole = change.kind === "role" ? sql`${change.role}::text` : sql`t.role`;
  const newActive = change.kind === "status" ? sql`${change.active}::boolean` : sql`t.active`;
  return sql`
    with actor as materialized (
      select ${user.id} as id, ${user.role} as role
      from ${session} inner join ${user} on ${user.id} = ${session.userId}
      where ${currentPermissionSessionConditions(identity, permission, sql`clock_timestamp()`)}
      for update of ${user}, ${session}
    ), target as materialized (
      select u.id, u.role, u.active from "user" u
      where u.id = ${change.targetId} and exists (select 1 from actor)
      for update of u
    ), changed as (
      update "user" u set role = ${newRole}, active = ${newActive}, updated_at = clock_timestamp()
      from target t, actor a
      where u.id = t.id
        and a.id <> t.id
        and t.role = ${change.expectedRole} and t.active = ${change.expectedActive}
        and (a.role in (${sql.join(privilegedRoles.map((role) => sql`${role}`), sql`, `)}) or t.role = 'staff')
        and (t.role <> ${newRole} or t.active <> ${newActive})
        and (not (t.role = 'super_admin' and t.active and (${newRole} <> 'super_admin' or not ${newActive}))
          or (select count(*) from "user" where role = 'super_admin' and active) > 1)
      returning u.id, u.role, u.active, t.role as before_role, t.active as before_active, a.id as actor_id
    ), revoked as (
      delete from "session" s using changed c where s.user_id = c.id returning s.id
    ), logged as (
      insert into admin_audit (id, actor_id, target_id, action, before_role, after_role, before_active, after_active)
      select ${crypto.randomUUID()}, actor_id, id, ${change.kind}, before_role, role, before_active, active from changed
      returning id
    )
    select exists(select 1 from logged) as ok`;
}

export function auditQuery(identity: AuthSession) {
  return sql`select id, actor_id as "actorId", target_id as "targetId", action,
    before_role as "beforeRole", after_role as "afterRole", before_active as "beforeActive",
    after_active as "afterActive", created_at as "createdAt"
    from admin_audit
    where exists (select 1 from ${session} inner join ${user} on ${user.id} = ${session.userId}
      where ${currentPermissionSessionConditions(identity, "audit:read", sql`clock_timestamp()`)})
    order by created_at desc, id desc limit 50`;
}

// Uses the same management lock and current-session checks as access changes.
export function createUserQuery(identity: AuthSession, input: z.infer<typeof userCreate>, passwordHash: string) {
  const id = crypto.randomUUID();
  return sql`with actor as materialized (
    select ${user.id} as id from ${session} inner join ${user} on ${user.id} = ${session.userId}
    where ${currentPermissionSessionConditions(identity, "users:create", sql`clock_timestamp()`)}
    for update of ${user}, ${session}
  ), created as (
    insert into "user" (id, name, email, role, active, email_verified)
    select ${id}, ${input.name}, ${input.email}, ${input.role}, ${input.active}, false from actor
    where not exists (select 1 from "user" where lower(email) = ${input.email})
    returning id, role, active
  ), credential as (
    insert into account (id, account_id, provider_id, user_id, password)
    select ${crypto.randomUUID()}, id, 'credential', id, ${passwordHash} from created returning id
  ), logged as (
    insert into admin_audit (id, actor_id, target_id, action, before_role, after_role, before_active, after_active)
    select ${crypto.randomUUID()}, a.id, c.id, 'create', c.role, c.role, false, c.active
    from created c cross join actor a where exists (select 1 from credential) returning id
  ) select exists(select 1 from logged) as ok`;
}

function profileOrDeleteQuery(identity: AuthSession, change: Extract<UserChange, { kind: "profile" | "delete" }>) {
  const permission = change.kind === "delete" ? "users:delete" : "users:update";
  const mutation = change.kind === "delete" ? sql`
    delete from "user" u using target t where u.id = t.id
      and not exists (select 1 from inventory_movements where actor_id = t.id)
    returning u.id, u.role, u.active` : sql`
    update "user" u set name = ${change.name}, email = ${change.email},
      email_verified = case when u.email = ${change.email} then u.email_verified else false end,
      updated_at = clock_timestamp()
    from target t where u.id = t.id
      and not exists (select 1 from "user" other where lower(other.email) = ${change.email} and other.id <> t.id)
      and (u.name <> ${change.name} or u.email <> ${change.email})
    returning u.id, u.role, u.active`;
  return sql`with actor as materialized (
    select ${user.id} as id from ${session} inner join ${user} on ${user.id} = ${session.userId}
    where ${currentPermissionSessionConditions(identity, permission, sql`clock_timestamp()`)}
    for update of ${user}, ${session}
  ), target as materialized (
    select u.id from "user" u cross join actor a
    where u.id = ${change.targetId} and u.id <> a.id
      and u.role = ${change.expectedRole} and u.active = ${change.expectedActive}
      and u.name = ${change.expectedName} and u.email = ${change.expectedEmail}
      and (u.role <> 'super_admin' or not u.active or
        (select count(*) from "user" where role = 'super_admin' and active) > 1)
    for update of u
  ), changed as (${mutation}), revoked as (
    delete from "session" s using changed c where s.user_id = c.id returning s.id
  ), logged as (
    insert into admin_audit (id, actor_id, target_id, action, before_role, after_role, before_active, after_active)
    select ${crypto.randomUUID()}, a.id, c.id, ${change.kind}, c.role, c.role, c.active,
      ${change.kind === "delete" ? sql`false` : sql`c.active`}
    from changed c cross join actor a returning id
  ) select exists(select 1 from logged) as ok`;
}
