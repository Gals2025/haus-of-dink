import "server-only";

type EmailSettings = { baseURL: string; apiKey?: string; from?: string };

/** Await provider acceptance; never log the request, URL, token or provider body. */
export function createPasswordResetSender(settings: EmailSettings, send: typeof fetch = fetch) {
  return async ({ user, token }: { user: { email: string }; token: string }) => {
    if (!settings.apiKey || !settings.from) {
      console.error("Password reset email delivery is not configured.");
      throw new Error("Password reset email delivery is not configured.");
    }
    // A fragment is never sent to the web server or included in Referer headers.
    // Better Auth still validates and atomically consumes the token on POST.
    const link = new URL("/admin/reset-password", settings.baseURL);
    link.hash = new URLSearchParams({ token }).toString();
    try {
      const response = await send("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: settings.from,
          to: [user.email],
          subject: "Reset your Haus of Dink staff password",
          text: `Reset your staff password using this single-use link within 15 minutes:\n\n${link.href}\n\nIf you did not request this, ignore this email. Your password has not changed.`,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Delivery rejected");
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string" || !result.id) {
        throw new Error("Missing delivery receipt");
      }
    } catch {
      // Do not propagate SDK/network errors containing request bodies or secrets.
      console.error("Password reset email delivery failed.");
      throw new Error("Password reset email delivery failed.");
    }
  };
}
