import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "@/server/db";
import * as schema from "@/server/db/schema";
import { staffAuthOptions } from "./options";
import { getServerEnv } from "@/server/env";

function createAuth() {
  const env = getServerEnv();
  if (!env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) {
    throw new Error("Better Auth server configuration is missing.");
  }
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    ...staffAuthOptions,
    advanced: { useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://") },
  });
}

let authInstance: ReturnType<typeof createAuth> | undefined;

export function getAuth(): ReturnType<typeof createAuth> {
  if (!authInstance) authInstance = createAuth();
  return authInstance;
}
