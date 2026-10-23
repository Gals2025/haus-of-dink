import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { user, session, account, rateLimit } from "../src/server/db/schema/auth";

test("auth migration and database security invariants", async (t) => {
  const client = new PGlite();
  const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
    await t.test("public signup defaults to inactive staff", async () => {
      await db.insert(user).values({ id: "staff-1", name: "Staff", email: "staff@example.test" });
      const [row] = await db.select().from(user).where(eq(user.id, "staff-1"));
      assert.equal(row?.active, false);
      assert.equal(row?.role, "staff");
      assert.equal(row?.emailVerified, false);
    });
    await t.test("invalid roles and duplicate emails are rejected", async () => {
      await assert.rejects(db.insert(user).values({ id: "bad-role", name: "Bad", email: "bad@example.test", role: "owner" }));
      await assert.rejects(db.insert(user).values({ id: "duplicate", name: "Duplicate", email: "staff@example.test" }));
    });
    await t.test("bootstrap sentinel key cannot be reused", async () => {
      const id = "00000000-0000-4000-8000-000000000001";
      await db.insert(user).values({ id, name: "Super Admin", email: "admin@example.test", role: "super_admin", active: true });
      await assert.rejects(db.insert(user).values({ id, name: "Another Admin", email: "another@example.test", role: "super_admin", active: true }));
    });
    await t.test("sessions and accounts cascade when a user is deleted", async () => {
      await db.insert(account).values({ id: "account-1", accountId: "staff-1", providerId: "credential", userId: "staff-1", password: "test-hash" });
      await db.insert(session).values({ id: "session-1", token: "test-token", userId: "staff-1", expiresAt: new Date(Date.now() + 3600000) });
      await db.delete(user).where(eq(user.id, "staff-1"));
      assert.equal((await db.select().from(session)).length, 0);
      assert.equal((await db.select().from(account)).length, 0);
    });
    await t.test("rate limiting keys are unique", async () => {
      await db.insert(rateLimit).values({ id: "rate-1", key: "login:test", count: 1, lastRequest: new Date() });
      await assert.rejects(db.insert(rateLimit).values({ id: "rate-2", key: "login:test", count: 2, lastRequest: new Date() }));
    });
  } finally {
    await client.close();
  }
});
