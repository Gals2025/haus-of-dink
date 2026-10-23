"use client";

import { useState } from "react";

export function AdminSignOut() {
  const [pending, setPending] = useState(false);
  async function signOut() {
    setPending(true);
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error("Unable to sign out");
      window.location.replace("/admin/login");
    } catch {
      setPending(false);
      window.alert("Unable to sign out. Please try again.");
    }
  }
  return <button type="button" onClick={signOut} disabled={pending} className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">{pending ? "Signing out…" : "Sign out"}</button>;
}
