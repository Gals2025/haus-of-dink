/**
 * One-time setup after auth migrations have been reviewed and applied.
 * Usage: BOOTSTRAP_ADMIN_EMAIL=... BOOTSTRAP_ADMIN_PASSWORD=... npm run auth:bootstrap
 * Never pass passwords as CLI arguments or commit them to files.
 */
import { loadEnvConfig } from "@next/env";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { account, user } from "../src/server/db/schema/auth";

loadEnvConfig(process.cwd());

// Fixed primary key acts as a database-enforced one-time bootstrap sentinel.
// Concurrent attempts cannot both insert this user, even if both pass preflight.
const BOOTSTRAP_USER_ID = "00000000-0000-4000-8000-000000000001";

async function main() {
  const url = process.env.DATABASE_URL;
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || "Super Admin";
  if (!url || !email || !password || password.length < 16 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Set DATABASE_URL, BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD (at least 16 characters).");
  }
  const db = drizzle(neon(url));
  const existing = await db.select({ id: user.id }).from(user).limit(1);
  if (existing.length) throw new Error("Bootstrap disabled: a user already exists. Use an audited administrative recovery procedure.");
  const { hashPassword } = await import("better-auth/crypto");
  const userId = BOOTSTRAP_USER_ID;
  const accountId = crypto.randomUUID();
  const hashed = await hashPassword(password);
  // Neon HTTP supports atomic batch transactions, not interactive transactions.
  try {
    await db.batch([
    db.insert(user).values({ id: userId, name, email, role: "super_admin", active: true, emailVerified: true }),
    db.insert(account).values({ id: accountId, userId, accountId: userId, providerId: "credential", password: hashed }),
    ]);
  } catch {
    // Avoid printing database errors that may include sensitive connection details.
    throw new Error("Bootstrap transaction failed. Check schema and whether bootstrap already ran.");
  }
  console.log("Super Admin created. Remove bootstrap credentials from the environment.");
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Bootstrap failed"); process.exitCode = 1; });
