"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { roles, type ManagedUser, type UserChange } from "@/server/admin/contracts";
import { UserForm } from "./user-form";
import { changeUser } from "./actions";

export function UserTable({ users, viewerId, canAssignRoles, canChangeStatus, canManagePrivileged, canEdit, canDelete }: {
  users: ManagedUser[]; viewerId: string; canAssignRoles: boolean; canChangeStatus: boolean; canManagePrivileged: boolean; canEdit: boolean; canDelete: boolean;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [proposed, setProposed] = useState<{ user: ManagedUser; change: UserChange } | null>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  function propose(user: ManagedUser, change: UserChange) {
    setProposed({ user, change });
    setMessage(""); setError("");
    dialog.current?.showModal();
  }
  function cancel() { if (!pending) { dialog.current?.close(); setProposed(null); } }
  function confirm() {
    if (!proposed || pending) return;
    startTransition(async () => {
      try {
        const result = await changeUser(proposed.change);
        if (result.ok) { setMessage(proposed.change.kind === "delete" ? "Account deleted. Audit history was preserved." : "Account updated. Existing sessions were revoked."); router.refresh(); }
        else setError(result.error);
      } catch { setError("Unable to save the change. Refresh before trying again."); }
      dialog.current?.close(); setProposed(null);
    });
  }
  return <div className="space-y-4" aria-busy={pending}>
    {message && <p role="status" className="rounded-lg border bg-secondary p-3 text-sm">{message}</p>}
    {error && <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</p>}
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Team accounts and administrative access</caption>
        <thead className="border-b bg-muted"><tr>{["Team member", "Role", "Status", "Actions"].map((label) => <th key={label} scope="col" className="p-4 font-medium">{label}</th>)}</tr></thead>
        <tbody>{users.map((user) => {
          const canManage = user.id !== viewerId && (user.role === "staff" || canManagePrivileged);
          const expected = { targetId: user.id, expectedRole: user.role, expectedActive: user.active };
          return <tr key={`${user.id}-${user.role}-${user.active}`} className="border-b last:border-0">
            <td className="p-4"><p className="font-medium">{user.name}{user.id === viewerId && " (you)"}</p><p className="mt-1 text-muted-foreground">{user.email}</p></td>
            <td className="p-4"><Badge variant="outline">{user.role.replaceAll("_", " ")}</Badge></td>
            <td className="p-4"><Badge variant={user.active ? "default" : "secondary"}>{user.active ? "Active" : "Inactive"}</Badge></td>
            <td className="p-4"><div className="flex flex-wrap items-center gap-2">
              {canManage && canAssignRoles && <select aria-label={`Change role for ${user.name}`} value={user.role} disabled={pending}
                className="rounded-md border bg-background p-2" onChange={(event) => {
                  const role = event.target.value as ManagedUser["role"];
                  if (role !== user.role) propose(user, { ...expected, kind: "role", role });
                }}>
                {roles.map((role) => <option key={role} value={role}>{role.replaceAll("_", " ")}</option>)}
              </select>}
              {canManage && canChangeStatus && <Button variant={user.active ? "outline" : "default"} size="sm" disabled={pending}
                onClick={() => propose(user, { ...expected, kind: "status", active: !user.active })}>{user.active ? "Deactivate" : "Activate"}</Button>}
              {canManage && canEdit && <UserForm user={user} />}
              {canManage && canDelete && <Button variant="outline" size="sm" disabled={pending}
                onClick={() => propose(user, { ...expected, expectedName: user.name, expectedEmail: user.email, kind: "delete" })}>Delete</Button>}
              {!canManage && <span className="text-muted-foreground">Protected</span>}
            </div></td>
          </tr>;
        })}</tbody>
      </table>
      {users.length === 0 && <p className="p-10 text-center text-muted-foreground">No accounts match these filters.</p>}
    </div>
    <dialog ref={dialog} aria-labelledby="confirm-title" aria-describedby="confirm-description"
      onCancel={(event) => { event.preventDefault(); cancel(); }}
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border bg-card p-6 text-foreground shadow-xl backdrop:bg-black/40">
      <h2 id="confirm-title" className="text-2xl">Confirm access change</h2>
      <p id="confirm-description" className="mt-4 text-sm leading-6">
        {proposed?.change.kind === "role"
          ? `Change ${proposed.user.name}’s role from ${proposed.user.role.replaceAll("_", " ")} to ${proposed.change.role.replaceAll("_", " ")}?`
          : proposed?.change.kind === "delete" ? `Permanently delete ${proposed.user.name} (${proposed.user.email})? This cannot be undone. Audit history will be retained. Accounts with inventory history must be deactivated instead.`
          : `${proposed?.change.kind === "status" && proposed.change.active ? "Activate" : "Deactivate"} ${proposed?.user.name}’s account?`}
        {" "}All existing sessions will be revoked. This change will be recorded in the audit history.
      </p>
      <div className="mt-6 flex justify-end gap-3"><Button variant="outline" onClick={cancel} disabled={pending} autoFocus>Cancel</Button>
        <Button onClick={confirm} disabled={pending}>{pending ? "Saving…" : "Confirm change"}</Button></div>
    </dialog>
  </div>;
}
