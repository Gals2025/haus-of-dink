import { Brand } from "@/components/layout/brand";
import { PasswordResetForm } from "../password-reset-form";

export const metadata = { title: "Reset password | Haus of Dink", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <section className="w-full max-w-md rounded-xl border bg-background p-8 shadow-sm">
        <Brand />
        <h1 className="mt-8 text-2xl">Reset password</h1>
        <p className="mt-2 text-sm text-muted-foreground">Choose a new password for your staff account.</p>
        <PasswordResetForm mode="reset" />
      </section>
    </main>
  );
}
