import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { hashPassword } from "better-auth/crypto";
import * as schema from "../src/server/db/schema";
import { staffAuthOptions } from "../src/server/auth/options";

// No environment loading or external database connections. The HTTP handler is
// essential here: auth.api calls bypass Better Auth's HTTP rate-limit middleware.
test("rate-limit migration preserves legacy timestamps as numeric milliseconds", async () => {
  const client = new PGlite();
  const db = drizzle(client);
  const folder = await mkdtemp(join(tmpdir(), "hod-auth-migrations-"));
  try {
    await cp("./src/server/db/migrations", folder, { recursive: true });
    const journalPath = join(folder, "meta/_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 4);
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(db, { migrationsFolder: folder });
    const when = "2026-10-25T01:02:03.456Z";
    await client.query(`insert into rate_limit (id, key, count, last_request) values ($1, $2, $3, $4::timestamptz)`,
      ["legacy-bucket", "legacy-sign-in", 2, when]);
    await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
    const [bucket] = await db.select().from(schema.rateLimit);
    assert.deepEqual(bucket, { id: "legacy-bucket", key: "legacy-sign-in", count: 2, lastRequest: Date.parse(when) });
    assert.equal(typeof bucket?.lastRequest, "number");
    const columns = await client.query<{ data_type: string }>(`select data_type from information_schema.columns where table_name = 'rate_limit' and column_name = 'last_request'`);
    assert.equal(columns.rows[0]?.data_type, "bigint");
    await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
    assert.deepEqual((await db.select().from(schema.rateLimit))[0], bucket);
  } finally {
    await client.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test("real Better Auth HTTP sign-in and database-backed throttling", async (t) => {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const auth = betterAuth({
    ...staffAuthOptions,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    secret: "isolated-http-auth-secret-at-least-32-characters",
    baseURL: "http://localhost:3000",
    advanced: { useSecureCookies: false },
    logger: { disabled: true },
  });
  const email = "http-staff@example.test";
  const password = "isolated-http-password-12345";
  const signIn = (provided = password) => auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
    body: JSON.stringify({ email, password: provided }),
  }));
  let cookies = "";
  try {
    await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
    await db.insert(schema.user).values({ id: "http-staff", name: "HTTP Staff", email, role: "staff", active: true });
    await db.insert(schema.account).values({ id: "http-account", userId: "http-staff", providerId: "credential", accountId: "http-staff", password: await hashPassword(password) });
    await t.test("valid HTTP sign-in issues a usable session and persists a numeric rate-limit bucket", async () => {
      const response = await signIn();
      assert.equal(response.status, 200);
      cookies = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
      assert.ok(cookies);
      const identity = await auth.api.getSession({ headers: new Headers({ cookie: cookies }), query: { disableCookieCache: true } });
      assert.equal(identity?.user.id, "http-staff");
      const [bucket] = await db.select().from(schema.rateLimit);
      assert.ok(bucket); assert.equal(bucket.count, 1);
      assert.equal(typeof bucket.lastRequest, "number");
      assert.ok(Math.abs(bucket.lastRequest - Date.now()) < 10000);
    });
    await t.test("invalid credentials consume the bucket and the fourth sign-in is throttled", async () => {
      assert.equal((await signIn("incorrect-password-12345")).status, 401);
      assert.equal((await signIn("incorrect-password-12345")).status, 401);
      const response = await signIn();
      assert.equal(response.status, 429);
      assert.ok(Number(response.headers.get("X-Retry-After")) > 0);
      assert.doesNotMatch(await response.text(), /insert into|params:|toISOString|session.*token/i);
      const [bucket] = await db.select().from(schema.rateLimit);
      assert.equal(bucket?.count, 3);
      assert.equal((await db.select().from(schema.session)).length, 1);
    });
    await t.test("expired windows reset using millisecond arithmetic without a timer wait", async () => {
      const [bucket] = await db.select().from(schema.rateLimit); assert.ok(bucket);
      await db.update(schema.rateLimit).set({ lastRequest: Date.now() - 11000 }).where(eq(schema.rateLimit.id, bucket.id));
      assert.equal((await signIn()).status, 200);
      const [updated] = await db.select().from(schema.rateLimit);
      assert.equal(updated?.count, 1);
      assert.ok(updated && Math.abs(updated.lastRequest - Date.now()) < 10000);
    });
    await t.test("concurrent requests cannot exceed the database sign-in limit", async () => {
      await db.delete(schema.rateLimit);
      const responses = await Promise.all(Array.from({ length: 6 }, () => signIn("incorrect-password-12345")));
      assert.equal(responses.filter((response) => response.status === 401).length, 3);
      assert.equal(responses.filter((response) => response.status === 429).length, 3);
      const [bucket] = await db.select().from(schema.rateLimit);
      assert.equal(bucket?.count, 3);
    });
    await t.test("HTTP logout still revokes the authenticated session", async () => {
      const response = await auth.handler(new Request("http://localhost:3000/api/auth/sign-out", {
        method: "POST", headers: { cookie: cookies, Origin: "http://localhost:3000", "Content-Type": "application/json" },
        body: "{}",
      }));
      assert.equal(response.status, 200);
      assert.equal(await auth.api.getSession({ headers: new Headers({ cookie: cookies }), query: { disableCookieCache: true } }), null);
    });
  } finally { await client.close(); }
});
