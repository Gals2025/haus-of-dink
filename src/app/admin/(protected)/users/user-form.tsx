"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { roles, type ManagedUser } from "@/server/admin/contracts";
import { changeUser, createUser } from "./actions";

export function UserForm({ user }: { user?: ManagedUser }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const field = "mt-1 block w-full rounded-md border bg-background p-2";
  function close() { if (!pending) { dialog.current?.querySelector("form")?.reset(); dialog.current?.close(); } }
  return <div>
    <Button variant="outline" size={user ? "sm" : "default"} onClick={() => {
      setError(""); setMessage(""); dialog.current?.showModal();
    }}>{user ? "Edit profile" : "Add team member"}</Button>
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
    <dialog ref={dialog} aria-label={user ? `Edit ${user.name}` : "Add team member"}
      onCancel={(event) => { event.preventDefault(); close(); }}
      className="fixed inset-0 m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border bg-card p-6 text-foreground shadow-xl backdrop:bg-black/40">
      <h2 className="text-2xl">{user ? "Edit team member" : "Add team member"}</h2>
      <form className="mt-5 space-y-4" onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const form = event.currentTarget;
        const data = new FormData(form);
        const profile = { name: String(data.get("name")), email: String(data.get("email")) };
        setError("");
        startTransition(async () => {
          try {
            const result = user ? await changeUser({ ...profile, kind: "profile", targetId: user.id,
              expectedName: user.name, expectedEmail: user.email, expectedRole: user.role, expectedActive: user.active })
              : await createUser({ ...profile, password: String(data.get("password")), role: String(data.get("role")), active: data.get("active") === "on" });
            if (!result.ok) { setError(result.error); return; }
            form.reset(); dialog.current?.close();
            setMessage(user ? "Profile updated. Existing sessions were revoked." : "Team member created.");
            router.refresh();
          } catch { setError("Unable to save. Refresh and try again."); }
          finally {
            const password = form.elements.namedItem("password");
            if (password instanceof HTMLInputElement) password.value = "";
          }
        });
      }}>
        <fieldset disabled={pending} className="space-y-4">
          <label className="block text-sm">Name<input className={field} name="name" required maxLength={100} defaultValue={user?.name} autoComplete="off" autoFocus /></label>
          <label className="block text-sm">Email<input className={field} name="email" type="email" required maxLength={254} defaultValue={user?.email} autoComplete="off" /></label>
          {!user && <>
            <label className="block text-sm">Initial password<input className={field} name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
            <p className="text-xs text-muted-foreground">Use 12–128 characters. Share the initial password securely. The member can use Forgot password to set their own.</p>
            <label className="block text-sm">Role<select className={field} name="role" defaultValue="staff">{roles.map((role) => <option key={role} value={role}>{role.replaceAll("_", " ")}</option>)}</select></label>
            <label className="flex items-center gap-2 text-sm"><input name="active" type="checkbox" defaultChecked />Active account</label>
          </>}
          {user && <p className="text-sm text-muted-foreground">Profile changes sign this member out of all sessions. Email changes clear email verification.</p>}
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-3"><Button type="button" variant="outline" disabled={pending} onClick={close}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : user ? "Save profile" : "Create account"}</Button></div>
      </form>
    </dialog>
  </div>;
}
