import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { getServerEnv } from "../env";
import * as schema from "./schema";

function createDatabase() {
  const { DATABASE_URL } = getServerEnv();
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is required for database access.");
  }
  // HTTP queries do not hold TCP/WebSocket connections across Vercel requests.
  // Use db.batch() for atomic, non-interactive transactions in this phase.
  return drizzle(neon(DATABASE_URL), { schema });
}

let database: ReturnType<typeof createDatabase> | undefined;

/** Lazy and server-only: importing this module does not require credentials. */
export function getDb() {
  return (database ??= createDatabase());
}
