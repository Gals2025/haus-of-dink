"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      if (!response.ok) throw new Error("Sign in failed");
      const check = await fetch("/api/admin/session", { credentials: "same-origin", cache: "no-store" });
      if (!check.ok) {
        await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin" });
        throw new Error("Unauthorized staff");
      }
      router.replace("/admin");
      router.refresh();
    } catch {
      setError("Unable to sign in. Check your credentials or try again later.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="mt-6 space-y-4" onSubmit={submit}>
      <label className="block text-sm">Email
        <input name="email" type="email" autoComplete="username" required className="mt-1 w-full rounded-md border bg-background p-3" />
      </label>
      <label className="block text-sm">Password
        <input name="password" type="password" autoComplete="current-password" required className="mt-1 w-full rounded-md border bg-background p-3" />
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <button disabled={pending} className="w-full rounded-md bg-primary p-3 text-primary-foreground disabled:opacity-50">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
