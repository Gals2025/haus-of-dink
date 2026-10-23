import Link from "next/link";
import { Brand } from "@/components/layout/brand";
import { LoginForm } from "./login-form";

export const metadata = { title: "Staff sign in | Haus of Dink", robots: { index: false, follow: false } };

export default function AdminLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <section className="w-full max-w-md rounded-xl border bg-background p-8 shadow-sm">
        <Brand />
        <h1 className="mt-8 text-2xl">Staff sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">Authorized Haus of Dink team members only.</p>
        <LoginForm />
        <Link className="mt-6 block text-sm text-primary underline" href="/">Return to storefront</Link>
      </section>
    </main>
  );
}
