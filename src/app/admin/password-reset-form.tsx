"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

export function PasswordResetForm({ mode }: { mode: "request" | "reset" }) {
  const token = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (mode !== "reset") return;
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (value) token.current = value;
    // Keep the secret only in memory, never storage or subsequent navigation.
    window.history.replaceState(null, "", window.location.pathname);
  }, [mode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const values = new FormData(element);
    setError("");
    if (mode === "reset" && !token.current) {
      setError("This reset link is invalid. Request a new link below.");
      return;
    }
    if (mode === "reset" && values.get("password") !== values.get("confirmPassword")) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch(mode === "request" ? "/api/auth/request-password-reset" : "/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(mode === "request"
          ? { email: values.get("email"), redirectTo: `${window.location.origin}/admin/reset-password` }
          : { token: token.current, newPassword: values.get("password") }),
      });
      if (!response.ok) {
        if (response.status === 429) setError("Too many attempts. Please wait a minute before trying again.");
        else if (mode === "reset" && response.status === 400) setError("This link has expired or was already used. Request a new reset link.");
        else setError("Unable to complete your request. Please try again later.");
        return;
      }
      token.current = null;
      element.reset();
      setDone(true);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (done) return (
    <div className="mt-6 space-y-4">
      <p role="status" className="text-sm">{mode === "request"
        ? "If an account exists for that email, check your inbox and spam folder for a reset link. The link expires in 15 minutes."
        : "Your password has been reset. Sign in with your new password."}</p>
      <Link className="block text-sm text-primary underline" href="/admin/login">Return to sign in</Link>
    </div>
  );
  return (
    <form className="mt-6 space-y-4" onSubmit={submit}>
      {mode === "request" ? (
        <label className="block text-sm">Email
          <input name="email" type="email" autoComplete="username" required maxLength={254} className="mt-1 w-full rounded-md border bg-background p-3" />
        </label>
      ) : (<>
        <p className="text-sm text-muted-foreground">Use 12–128 characters. After resetting, sign in again on your devices.</p>
        <label className="block text-sm">New password
          <input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className="mt-1 w-full rounded-md border bg-background p-3" />
        </label>
        <label className="block text-sm">Confirm new password
          <input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} className="mt-1 w-full rounded-md border bg-background p-3" />
        </label>
      </>)}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <button disabled={pending} className="w-full rounded-md bg-primary p-3 text-primary-foreground disabled:opacity-50">
        {pending ? "Please wait…" : mode === "request" ? "Send reset link" : "Reset password"}
      </button>
      {mode === "reset" && <Link className="block text-sm text-primary underline" href="/admin/forgot-password">Request a new reset link</Link>}
      <Link className="block text-sm text-primary underline" href="/admin/login">Return to sign in</Link>
    </form>
  );
}
