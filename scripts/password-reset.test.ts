import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import * as schema from "../src/server/db/schema";
import { staffAuthOptions } from "../src/server/auth/options";
import { createPasswordResetSender } from "../src/server/auth/password-reset-email";

test("password reset uses real Better Auth endpoints and isolated PostgreSQL", async (t) => {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const messages: { to: string[]; text: string }[] = [];
  let failDelivery = false;
  const sender = createPasswordResetSender({ baseURL: "http://localhost:3000", apiKey: "test-key", from: "staff@example.test" }, async (input, init) => {
    assert.equal(input, "https://api.resend.com/emails");
    if (failDelivery) throw new Error(`Do not expose ${init?.body}`);
    messages.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "test-receipt" });
  });
  const auth = betterAuth({
    ...staffAuthOptions,
    emailAndPassword: { ...staffAuthOptions.emailAndPassword, sendResetPassword: sender },
    database: drizzleAdapter(db, { provider: "pg", schema }),
    secret: "isolated-reset-secret-at-least-32-characters",
    baseURL: "http://localhost:3000",
    advanced: { useSecureCookies: false },
  });
  const email = "reset-admin@example.test";
  const oldPassword = "isolated-old-password-12345";
  const newPassword = "isolated-new-password-67890";
  const post = (path: string, body: object) => auth.handler(new Request(`http://localhost:3000/api/auth/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" }, body: JSON.stringify(body),
  }));
  const requestReset = (address = email) => post("request-password-reset", { email: address, redirectTo: "http://localhost:3000/admin/reset-password" });
  const lastToken = () => {
    const text = messages.at(-1)?.text;
    assert.ok(text);
    const url = new URL(text.split("\n\n")[1]!);
    assert.equal(url.pathname, "/admin/reset-password");
    assert.equal(url.search, "");
    const token = new URLSearchParams(url.hash.slice(1)).get("token");
    assert.ok(token);
    return token;
  };
  const clearLimits = () => db.delete(schema.rateLimit);
  try {
    await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
    await db.insert(schema.user).values({ id: "reset-admin", name: "Reset admin", email, role: "admin", active: true });
    await db.insert(schema.account).values({ id: "reset-account", userId: "reset-admin", providerId: "credential", accountId: "reset-admin", password: await hashPassword(oldPassword) });

    await t.test("known and unknown emails receive the same response without a token", async () => {
      const known = await requestReset();
      const unknown = await requestReset("unknown@example.test");
      assert.equal(known.status, 200); assert.equal(unknown.status, 200);
      assert.deepEqual(await known.json(), await unknown.json());
      assert.equal(messages.length, 1);
      assert.deepEqual(messages[0]?.to, [email]);
      const token = lastToken();
      const [row] = await db.select().from(schema.verification);
      assert.ok(row);
      assert.ok(row.expiresAt.getTime() - Date.now() <= 15 * 60 * 1000);
      assert.ok(row.expiresAt.getTime() - Date.now() > 14 * 60 * 1000);
      assert.ok(!row.identifier.includes(token));
    });

    await t.test("reset revokes sessions, changes credentials, preserves access state and rejects replay", async () => {
      const signIn = await post("sign-in/email", { email, password: oldPassword });
      assert.equal(signIn.status, 200);
      assert.equal((await db.select().from(schema.session)).length, 1);
      const token = lastToken();
      const reset = await post("reset-password", { token, newPassword });
      assert.equal(reset.status, 200);
      assert.doesNotMatch(await reset.text(), new RegExp(token));
      assert.equal((await db.select().from(schema.session)).length, 0);
      const [user] = await db.select().from(schema.user);
      assert.equal(user?.role, "admin"); assert.equal(user?.active, true);
      assert.equal((await post("reset-password", { token, newPassword: oldPassword })).status, 400);
      assert.equal((await post("sign-in/email", { email, password: oldPassword })).status, 401);
      assert.equal((await post("sign-in/email", { email, password: newPassword })).status, 200);
      await clearLimits();
    });

    await t.test("expired and invalid tokens cannot change a password", async () => {
      assert.equal((await requestReset()).status, 200);
      const token = lastToken();
      await db.update(schema.verification).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.verification.value, "reset-admin"));
      assert.equal((await post("reset-password", { token, newPassword: oldPassword })).status, 400);
      assert.equal((await post("reset-password", { token: "invalid-token", newPassword: oldPassword })).status, 400);
      const [account] = await db.select().from(schema.account);
      assert.ok(account?.password);
      assert.equal(await verifyPassword({ hash: account.password, password: newPassword }), true);
      await clearLimits();
    });

    await t.test("weak passwords and untrusted redirects are rejected", async () => {
      assert.equal((await requestReset()).status, 200);
      const token = lastToken();
      assert.equal((await post("reset-password", { token, newPassword: "short" })).status, 400);
      assert.equal((await post("reset-password", { token, newPassword: "a".repeat(129) })).status, 400);
      assert.equal((await post("request-password-reset", { email, redirectTo: "https://attacker.example/reset" })).status, 403);
      await clearLimits();
    });

    await t.test("concurrent token reuse succeeds only once", async () => {
      assert.equal((await requestReset()).status, 200);
      const token = lastToken();
      const responses = await Promise.all([post("reset-password", { token, newPassword }), post("reset-password", { token, newPassword: oldPassword })]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
      await clearLimits();
    });

    await t.test("email request throttling is enforced by the HTTP handler", async () => {
      const responses = [];
      for (let i = 0; i < 4; i++) responses.push(await requestReset());
      assert.deepEqual(responses.map((response) => response.status), [200, 200, 200, 429]);
      await clearLimits();
    });

    await t.test("delivery failures retain generic responses and emit only a fixed diagnostic", async (subtest) => {
      failDelivery = true;
      const diagnostic = subtest.mock.method(console, "error", () => {});
      const previousCount = messages.length;
      const response = await requestReset();
      // Better Auth deliberately absorbs delivery errors to avoid disclosing users.
      assert.equal(response.status, 200);
      assert.equal(messages.length, previousCount);
      assert.deepEqual(diagnostic.mock.calls.map((call) => call.arguments), [["Password reset email delivery failed."]]);
      assert.doesNotMatch(await response.text(), /test-key|reset-password.*token|Do not expose|reset-admin@example/);
    });
  } finally { await client.close(); }
});

test("email sender fails safely for missing credentials, rejected delivery and missing receipts", async () => {
  const payload = { user: { email: "test@example.test" }, token: "private-token" };
  let called = false;
  const missing = createPasswordResetSender({ baseURL: "https://staging.example.test" }, async () => { called = true; throw new Error(); });
  await assert.rejects(missing(payload), { message: "Password reset email delivery is not configured." });
  assert.equal(called, false);
  for (const response of [Response.json({ error: payload.token }, { status: 403 }), Response.json({})]) {
    const sender = createPasswordResetSender({ baseURL: "https://staging.example.test", apiKey: "test-key", from: "staff@example.test" }, async () => response);
    await assert.rejects(sender(payload), { message: "Password reset email delivery failed." });
  }
});
