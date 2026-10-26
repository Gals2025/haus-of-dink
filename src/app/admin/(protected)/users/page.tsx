import { requirePermission, hasPermission } from "@/server/auth/authorize";
import { userManagement } from "@/server/admin/service";
import { userFilters, roles } from "@/server/admin/contracts";
import { UserTable } from "./user-table";
import Link from "next/link";

export default async function UsersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await requirePermission("users:read");
  const params = await searchParams;
  const parsed = userFilters.safeParse({ search: params.search, role: params.role, status: params.status, page: params.page });
  const filters = parsed.success ? parsed.data : userFilters.parse({});
  const { users, hasMore } = await userManagement.list(filters);
  function pageLink(page: number) {
    return `/admin/users?${new URLSearchParams({ ...filters, page: String(page) })}`;
  }
  return <div className="space-y-6">
    <div><p className="text-xs tracking-widest">HAUS OF DINK / WORKSPACE</p>
      <h1 className="mt-3 text-4xl">People & access</h1>
      <p className="mt-3 text-muted-foreground">Manage your team’s access to Haus of Dink.</p></div>
    {!parsed.success && <p role="alert" className="text-destructive">Invalid filters. Showing the first page.</p>}
    <form className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4" action="/admin/users">
      <label className="min-w-48 flex-1 text-sm">Search name or email
        <input name="search" defaultValue={filters.search} maxLength={100} className="mt-1 w-full rounded-md border bg-background p-2" />
      </label>
      <label className="text-sm">Role<select name="role" defaultValue={filters.role} className="mt-1 block rounded-md border bg-background p-2">
        <option value="all">All roles</option>{roles.map((role) => <option key={role} value={role}>{role.replaceAll("_", " ")}</option>)}
      </select></label>
      <label className="text-sm">Status<select name="status" defaultValue={filters.status} className="mt-1 block rounded-md border bg-background p-2">
        <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
      </select></label>
      <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Apply filters</button>
    </form>
    <UserTable users={users} viewerId={identity.staff.id}
      canAssignRoles={hasPermission(identity.staff.role, "users:role")}
      canChangeStatus={hasPermission(identity.staff.role, "users:status")}
      canManagePrivileged={hasPermission(identity.staff.role, "users:privileged")} />
    <nav aria-label="User pages" className="flex items-center gap-4 text-sm">
      {filters.page > 1 && <Link href={pageLink(filters.page - 1)}>Previous</Link>}
      <span>Page {filters.page}</span>{hasMore && <Link href={pageLink(filters.page + 1)}>Next</Link>}
    </nav>
    <p className="text-sm text-muted-foreground">Your own access is protected. Role and status changes sign the affected user out of all sessions.</p>
  </div>;
}
