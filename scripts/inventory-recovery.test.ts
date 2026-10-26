import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = (name: string) => readFile(`src/server/db/migrations/${name}.sql`, "utf8");
const readRepair = () => readFile("scripts/sql/repair-production-inventory.sql", "utf8");

test("production recovery preserves partial inventory and auth, creates missing catalog atomically", async () => {
  const repair = await readRepair();
  const db = new PGlite();
  try {
    await db.exec(await migration("0002_staff_auth"));
    await db.exec(await migration("0003_admin_audit"));
    await db.exec(await migration("0004_rate_limit_milliseconds"));
    await db.exec(`INSERT INTO "user" (id, name, email, role, active) VALUES ('existing-admin', 'Existing Admin', 'admin@example.test', 'super_admin', true);
      INSERT INTO account(id, account_id, provider_id, user_id, password) VALUES ('existing-account', 'existing-admin', 'credential', 'existing-admin', 'existing-fixture-hash');
      INSERT INTO session(id, token, user_id, expires_at) VALUES ('existing-session', 'fixture-token', 'existing-admin', now() + interval '1 hour');`);
    const inventory = await migration("0005_inventory");
    await db.exec(inventory.slice(0, inventory.indexOf("CREATE TABLE inventory_balances")));
    const before = (await db.query('SELECT row_to_json(u) AS data FROM "user" u')).rows;
    await db.exec(repair);
    assert.deepEqual((await db.query('SELECT row_to_json(u) AS data FROM "user" u')).rows, before);
    assert.equal((await db.query<{ password: string }>("SELECT password FROM account")).rows[0]?.password, "existing-fixture-hash");
    assert.equal((await db.query("SELECT * FROM session")).rows.length, 1);
    assert.equal((await db.query("SELECT * FROM inventory_locations")).rows.length, 1);
    assert.equal((await db.query("SELECT * FROM products")).rows.length, 0);
    assert.equal((await db.query("SELECT * FROM inventory_movements")).rows.length, 0);
    await db.exec(`INSERT INTO brands (name, slug) VALUES ('Test brand', 'test-brand');
      INSERT INTO categories(name, slug) VALUES ('Test category', 'test-category');
      INSERT INTO products(name, slug, brand_id, category_id) SELECT 'Test product', 'test-product', b.id, c.id FROM brands b, categories c;
      INSERT INTO product_variants(product_id, sku, price) SELECT id, 'RECOVERY-001', 10000 FROM products;
      SELECT inventory_apply('10000000-0000-4000-8000-000000000001', v.id, l.id,
        'OPENING_STOCK', 7, 'Recovery fixture opening', 'FIXTURE', null, 'existing-admin')
        FROM product_variants v, inventory_locations l;`);
    assert.equal((await db.query<{ on_hand: number }>("SELECT on_hand FROM inventory_balances")).rows[0]?.on_hand, 7);
    await assert.rejects(db.exec("UPDATE inventory_movements SET reason = 'edited'"));
    await assert.rejects(db.exec(repair));
    await db.exec("ROLLBACK");
    assert.equal((await db.query("SELECT * FROM inventory_movements")).rows.length, 1);
    assert.equal((await db.query<{ on_hand: number }>("SELECT on_hand FROM inventory_balances")).rows[0]?.on_hand, 7);
  } finally { await db.close(); }
});

test("recovery failure during catalog installation rolls back all new objects", async () => {
  const repair = await readRepair();
  const db = new PGlite();
  try {
    await db.exec(await migration("0002_staff_auth"));
    const inventory = await migration("0005_inventory");
    await db.exec(inventory.slice(0, inventory.indexOf("CREATE TABLE inventory_balances")));
    // An unexpected existing function forces failure after catalog DDL has run.
    await db.exec("CREATE FUNCTION public.catalog_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;");
    await assert.rejects(db.exec(repair));
    await db.exec("ROLLBACK");
    assert.equal((await db.query<{ table: string | null }>("SELECT to_regclass('public.products') AS table")).rows[0]?.table, null);
    assert.equal((await db.query<{ type: string | null }>("SELECT to_regtype('public.catalog_status') AS type")).rows[0]?.type, null);
    assert.equal((await db.query("SELECT * FROM inventory_locations")).rows.length, 1);
  } finally { await db.close(); }
});
