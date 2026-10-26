import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

const folder = "src/server/db/migrations";
const script = () => readFile("scripts/sql/reconcile-manual-migration-history-neon.sql", "utf8");
const migration = (tag: string) => readFile(`${folder}/${tag}.sql`, "utf8");
const baselineTags = ["0000_catalog_foundation", "0001_catalog_integrity", "0002_staff_auth",
  "0003_admin_audit", "0004_rate_limit_milliseconds", "0005_inventory", "0006_inventory_integrity"];

// PGlite's disposable database is named postgres. Change only the database-name
// guard for positive fixtures; test the unmodified production guard separately.
function localScript(sql: string) {
  assert.equal(sql.split("current_database() = 'neondb'").length, 2);
  return sql.replace("current_database() = 'neondb'", "current_database() = 'postgres'");
}
async function install(client: PGlite, recovery = false) {
  if (recovery) {
    for (const tag of baselineTags.slice(2, 5)) await client.exec(await migration(tag));
    const inventory = await migration("0005_inventory");
    await client.exec(inventory.slice(0, inventory.indexOf("CREATE TABLE inventory_balances")));
    await client.exec(await readFile("scripts/sql/repair-production-inventory.sql", "utf8"));
    await client.exec(await migration("0006_inventory_integrity"));
  } else {
    // Manual installation deliberately leaves Drizzle bookkeeping absent.
    for (const tag of baselineTags) await client.exec(await migration(tag));
  }
}
async function ledgerExists(client: PGlite) {
  return (await client.query<{ ledger: string | null }>(
    "SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger",
  )).rows[0]!.ledger !== null;
}

test("manual migration reconciliation preserves data and resumes normal migration tracking", async (t) => {
  for (const recovery of [false, true]) {
    await t.test(recovery ? "partial-installation recovery path" : "complete manual installation path", async () => {
      const client = new PGlite();
      try {
        await install(client, recovery);
        await client.exec(`INSERT INTO brands(name,slug) VALUES ('Preserved brand','preserved-brand');
          INSERT INTO "user"(id,name,email,active,role) VALUES ('preserved-admin','Admin','admin@example.test',true,'super_admin');
          INSERT INTO account(id,account_id,provider_id,user_id,password) VALUES ('preserved-account','preserved-admin','credential','preserved-admin','fixture-hash');
          INSERT INTO session(id,token,user_id,expires_at) VALUES ('preserved-session','fixture-token','preserved-admin',now()+interval '1 hour');`);
        const snapshot = () => client.query(`SELECT
          (SELECT jsonb_agg(b) FROM brands b) AS brands,
          (SELECT jsonb_agg(u) FROM "user" u) AS users,
          (SELECT jsonb_agg(a) FROM account a) AS accounts,
          (SELECT jsonb_agg(s) FROM session s) AS sessions,
          (SELECT jsonb_agg(l) FROM inventory_locations l) AS locations`);
        const before = (await snapshot()).rows;
        if (recovery) await client.exec("CREATE SCHEMA drizzle");
        await client.exec(localScript(await script()));
        const records = () => client.query<{ hash: string; created_at: string | number }>(
          "SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id",
        );
        const expected = readMigrationFiles({ migrationsFolder: folder }).slice(0, 7)
          .map((m) => ({ hash: m.hash, created_at: m.folderMillis }));
        const baseline = (await records()).rows;
        assert.deepEqual(baseline.map((r) => ({ ...r, created_at: Number(r.created_at) })), expected);
        await migrate(drizzle(client), { migrationsFolder: folder });
        assert.deepEqual((await records()).rows.slice(0, 7), baseline);
        assert.deepEqual((await snapshot()).rows, before);
        await assert.rejects(client.exec(localScript(await script())), /hod_baseline_verification/);
        await client.exec("ROLLBACK");
        assert.deepEqual((await records()).rows.slice(0, 7), baseline);
      } finally { await client.close(); }
    });
  }
});

test("reconciliation rejects the wrong database, schema drift and missing baseline data atomically", async (t) => {
  for (const problem of ["wrong database", "missing reversal index", "missing default location"] as const) {
    await t.test(problem, async () => {
      const client = new PGlite();
      try {
        await install(client);
        if (problem === "missing reversal index") await client.exec("DROP INDEX inventory_movements_one_reversal");
        if (problem === "missing default location") await client.exec("DELETE FROM inventory_locations");
        const sql = await script();
        await assert.rejects(client.exec(problem === "wrong database" ? sql : localScript(sql)), /hod_baseline_verification/);
        await client.exec("ROLLBACK");
        assert.equal(await ledgerExists(client), false);
        assert.equal((await client.query<{ count: number }>('SELECT count(*)::integer AS count FROM "user"')).rows[0]!.count, 0);
      } finally { await client.close(); }
    });
  }
});
