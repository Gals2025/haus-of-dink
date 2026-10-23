import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

// Offline generation/checking needs no credentials. Network commands fail
// closed when DATABASE_URL is absent; no dummy URL or embedded credentials.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./src/server/db/migrations",
  ...(process.env.DATABASE_URL
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : {}),
  migrations: { schema: "drizzle", table: "__drizzle_migrations" },
  strict: true,
  verbose: false,
});
