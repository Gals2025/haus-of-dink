import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "../src/server/db/schema";
import { developmentCatalog as fixtures } from "./seed-data";
import { mainLocationId } from "../src/server/inventory/contracts";

const folder = "src/server/db/migrations";
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));

test("inventory foundation upgrades existing stock and enforces ledger references", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "hod-migrations-"));
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const variant = fixtures.variants[0]!.id;
  const location = mainLocationId;
  const actor = "foundation-admin";
  async function apply(type: string, quantity: number, reversal: string | null = null, request = crypto.randomUUID()) {
    const result = await client.query<{ id: string }>(
      "SELECT inventory_apply($1::uuid, $2::uuid, $3::uuid, $4::inventory_movement_type, $5::integer, 'Foundation fixture', '', NULL::uuid, $6::text, $7::uuid) AS id",
      [request, variant, location, type, quantity, actor, reversal],
    );
    return result.rows[0]!.id;
  }
  try {
    const journal = await json(`${folder}/meta/_journal.json`);
    await mkdir(join(temp, "meta"));
    await writeFile(join(temp, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.filter((e: { idx: number }) => e.idx <= 5) }));
    for (const entry of journal.entries.filter((e: { idx: number }) => e.idx <= 5)) {
      await copyFile(`${folder}/${entry.tag}.sql`, join(temp, `${entry.tag}.sql`));
    }
    await migrate(db, { migrationsFolder: temp });
    await t.test("reconstructed 0005 snapshot matches migrated tables, columns, enums and FK ownership", async () => {
      const baseline = await json(`${folder}/meta/0005_snapshot.json`);
      const tables = await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
      assert.deepEqual(tables.rows.map((r) => `public.${r.table_name}`).sort(), Object.keys(baseline.tables).sort());
      for (const table of Object.values(baseline.tables) as Array<{ name: string; columns: Record<string, { notNull: boolean; type: string }>; foreignKeys: Record<string, { columnsFrom: string[]; tableTo: string; columnsTo: string[]; onDelete: string }> }>) {
        const columns = await client.query<{ column_name: string; is_nullable: string; udt_name: string }>("SELECT column_name, is_nullable, udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [table.name]);
        assert.deepEqual(columns.rows.map((c) => c.column_name).sort(), Object.keys(table.columns).sort(), table.name);
        for (const column of columns.rows) {
          const definition = table.columns[column.column_name]!;
          // Primary-key columns can be declared notNull=false in Kit snapshots.
          if (definition.notNull) assert.equal(column.is_nullable, "NO");
          if (definition.type === "integer") assert.equal(column.udt_name, "int4");
          if (definition.type === "uuid") assert.equal(column.udt_name, "uuid");
        }
        // Handwritten SQL uses PostgreSQL's automatic constraint names; compare
        // relationships by columns, target and delete policy rather than names.
        const fks = await client.query<{ source: string[]; target: string; destination: string[]; deletion: string }>(`SELECT
          ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(n, ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY ord) AS source,
          c.confrelid::regclass::text AS target,
          ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(n, ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY ord) AS destination,
          c.confdeltype AS deletion FROM pg_constraint c WHERE c.conrelid=$1::regclass AND c.contype='f'`, [table.name === "user" ? '"user"' : table.name]);
        for (const fk of Object.values(table.foreignKeys)) {
          assert.ok(fks.rows.some((r) => JSON.stringify(r.source) === JSON.stringify(fk.columnsFrom) && r.target.replaceAll('"', '') === fk.tableTo && JSON.stringify(r.destination) === JSON.stringify(fk.columnsTo) && r.deletion === ({ cascade: "c", restrict: "r", "no action": "a" }[fk.onDelete])), `${table.name}: ${fk.columnsFrom}`);
        }
      }
      for (const entry of Object.values(baseline.enums) as Array<{ name: string; values: string[] }>) {
        const values = await client.query<{ enumlabel: string }>("SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname=$1 ORDER BY e.enumsortorder", [entry.name]);
        assert.deepEqual(values.rows.map((v) => v.enumlabel), entry.values);
      }
    });
    await db.insert(schema.brands).values(fixtures.brands);
    await db.insert(schema.categories).values(fixtures.categories);
    await db.insert(schema.products).values(fixtures.products);
    await db.insert(schema.productVariants).values(fixtures.variants);
    await client.query('INSERT INTO "user"(id,name,email,active,role) VALUES ($1, $1, $2, true, \'admin\')', [actor, "foundation@example.test"]);
    const opening = await client.query<{ id: string }>("SELECT inventory_apply($1::uuid,$2::uuid,$3::uuid,'OPENING_STOCK',10,'Existing opening','',null,$4) AS id", [crypto.randomUUID(), variant, location, actor]);
    const originalId = opening.rows[0]!.id;
    const before = (await client.query("SELECT * FROM inventory_balances")).rows;
    await migrate(db, { migrationsFolder: folder });
    await migrate(db, { migrationsFolder: folder });
    await t.test("upgrade preserves existing stock, history, and original writer interface", async () => {
      assert.deepEqual((await client.query("SELECT * FROM inventory_balances")).rows, before);
      const row = (await client.query<{ source_location_id: string | null; destination_location_id: string }>("SELECT * FROM inventory_movements WHERE id=$1", [originalId])).rows[0]!;
      assert.equal(row.source_location_id, null); assert.equal(row.destination_location_id, location);
      assert.equal((await client.query("SELECT * FROM drizzle.__drizzle_migrations")).rows.length, 7);
    });
    await t.test("full reversal is atomic, idempotent and unique; history remains immutable", async () => {
      const request = crypto.randomUUID();
      const reversal = await apply("ADJUSTMENT_OUT", 10, originalId, request);
      assert.equal(await apply("ADJUSTMENT_OUT", 10, originalId, request), reversal);
      const row = (await client.query<{ source_location_id: string; destination_location_id: string | null; reversal_of_id: string }>("SELECT * FROM inventory_movements WHERE id=$1", [reversal])).rows[0]!;
      assert.equal(row.source_location_id, location); assert.equal(row.destination_location_id, null); assert.equal(row.reversal_of_id, originalId);
      await apply("PURCHASE", 20);
      await assert.rejects(apply("ADJUSTMENT_OUT", 10, originalId));
      await assert.rejects(apply("ADJUSTMENT_IN", 10, reversal));
      for (const query of ["UPDATE inventory_movements SET reason='modified'", "DELETE FROM inventory_movements", "TRUNCATE inventory_movements"]) await assert.rejects(client.exec(query));
      assert.equal((await client.query<{ on_hand: number }>("SELECT on_hand FROM inventory_balances")).rows[0]!.on_hand, 20);
    });
    await t.test("invalid reversal references, quantity and direction roll back stock", async () => {
      const receipt = await apply("PURCHASE", 3);
      await assert.rejects(apply("ADJUSTMENT_OUT", 2, receipt));
      await assert.rejects(apply("ADJUSTMENT_IN", 3, receipt));
      await assert.rejects(apply("ADJUSTMENT_OUT", 3, crypto.randomUUID()));
      const second = crypto.randomUUID();
      await db.insert(schema.inventoryLocations).values({ id: second, name: "Other foundation location" });
      await client.query("SELECT inventory_apply($1::uuid,$2::uuid,$3::uuid,'PURCHASE',3,'Other location','',null,$4)", [crypto.randomUUID(), variant, second, actor]);
      await assert.rejects(client.query("SELECT inventory_apply($1::uuid,$2::uuid,$3::uuid,'ADJUSTMENT_OUT',3,'Wrong location','',null,$4,$5::uuid)", [crypto.randomUUID(), variant, second, actor, receipt]));
      assert.equal((await client.query<{ on_hand: number }>("SELECT on_hand FROM inventory_balances WHERE location_id=$1", [location])).rows[0]!.on_hand, 23);
    });
    await t.test("balance uniqueness, integer precision, location FKs and historical deletion restrictions", async () => {
      await assert.rejects(db.insert(schema.inventoryBalances).values({ variantId: variant, locationId: location }));
      await assert.rejects(db.insert(schema.inventoryBalances).values({ variantId: variant, locationId: crypto.randomUUID() }));
      await assert.rejects(client.query("UPDATE inventory_balances SET on_hand=$1 WHERE location_id=$2", ["1.5", location]));
      await assert.rejects(client.query("DELETE FROM inventory_locations WHERE id=$1", [location]));
      await assert.rejects(client.query("DELETE FROM product_variants WHERE id=$1", [variant]));
      await assert.rejects(client.query("DELETE FROM products WHERE id=$1", [fixtures.products[0]!.id]));
      await assert.rejects(client.query('DELETE FROM "user" WHERE id=$1', [actor]));
    });
    await t.test("direct ledger inserts cannot forge deltas, endpoints or reservation ownership", async () => {
      const base = { variantId: variant, locationId: location, type: "PURCHASE" as const, quantity: 1, beforeOnHand: 23, afterOnHand: 24, beforeReserved: 0, afterReserved: 0, actorId: actor, reason: "Direct constraint fixture" };
      await assert.rejects(db.insert(schema.inventoryMovements).values({ ...base, requestId: crypto.randomUUID(), afterOnHand: 25 }));
      await assert.rejects(client.query("INSERT INTO inventory_movements(request_id,variant_id,location_id,type,quantity,before_on_hand,after_on_hand,before_reserved,after_reserved,actor_id,reason,source_location_id) VALUES ($1,$2,$3,'PURCHASE',1,23,24,0,0,$4,'Forged endpoint',$3)", [crypto.randomUUID(), variant, location, actor]));
      const wrongVariant = fixtures.variants[1]!.id;
      await db.insert(schema.inventoryBalances).values({ variantId: wrongVariant, locationId: location });
      const reservation = crypto.randomUUID();
      await db.insert(schema.inventoryReservations).values({ id: reservation, variantId: wrongVariant, locationId: location, quantity: 1, remaining: 1, reference: "OTHER-SKU" });
      await assert.rejects(db.insert(schema.inventoryMovements).values({ ...base, type: "SALE", afterOnHand: 22, beforeReserved: 1, afterReserved: 0, reservationId: reservation, requestId: crypto.randomUUID() }));
      await assert.rejects(db.insert(schema.inventoryReservations).values({ id: crypto.randomUUID(), variantId: variant, locationId: location, quantity: 1, remaining: 1, reference: " " }));
    });
    await t.test("latest snapshot produces no duplicate schema SQL on subsequent generation", async () => {
      const current = await json(`${folder}/meta/0006_snapshot.json`);
      assert.deepEqual(await generateMigration(current, generateDrizzleJson(schema, current.id)), []);
    });
  } finally { await client.close(); await rm(temp, { recursive: true, force: true }); }
});
