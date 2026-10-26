import { Brand } from "@/components/layout/brand";
import { PasswordResetForm } from "../password-reset-form";

export const metadata = { title: "Forgot password | Haus of Dink", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <section className="w-full max-w-md rounded-xl border bg-background p-8 shadow-sm">
        <Brand />
        <h1 className="mt-8 text-2xl">Forgot password</h1>
        <p className="mt-2 text-sm text-muted-foreground">Enter your staff email to request a password reset link.</p>
        <PasswordResetForm mode="request" />
      </section>
    </main>
  );
}
