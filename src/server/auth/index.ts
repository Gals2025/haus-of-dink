import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "@/server/db";
import * as schema from "@/server/db/schema";
import { getServerEnv } from "@/server/env";

let authInstance: ReturnType<typeof betterAuth> | undefined;

export function getAuth() {
  if (authInstance) return authInstance;
  const env = getServerEnv();
  if (!env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) {
    throw new Error("Better Auth server configuration is missing.");
  }
  authInstance = betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, input: false, defaultValue: "staff" },
        active: { type: "boolean", required: false, input: false, defaultValue: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 30,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 10,
      storage: "database",
    },
    advanced: { useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://") },
  });
  return authInstance;
}
