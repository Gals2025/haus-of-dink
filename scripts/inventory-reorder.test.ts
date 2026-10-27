import assert from "node:assert/strict";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { catalogFixture } from "./catalog-fixture";
import { createReorderSettings } from "../src/server/inventory/reorder";
import { managementLock } from "../src/server/admin/queries";
import { stockQuery } from "../src/server/inventory/queries";
import { mainLocationId, stockFilters } from "../src/server/inventory/contracts";
import { createInventory } from "../src/server/inventory/service";

test("reorder settings authorize, isolate locations, preserve quantities and audit atomically", async () => {
  const f = await catalogFixture(); const { db, schema, client } = f;
  const change: Parameters<typeof createReorderSettings>[0]["change"] = (query) => db.transaction(async (tx) => {
    await tx.execute(managementLock);
    return (await tx.execute<{ authorized: boolean; found: boolean; logged: boolean }>(query)).rows[0];
  });
  const set = createReorderSettings({ authorize: f.storage.authorize, change });
  const input = { variantId: f.data.variants[0]!.id, locationId: mainLocationId, reorderLevel: 12 };
  const balances = () => db.select().from(schema.inventoryBalances).where(eq(schema.inventoryBalances.variantId, input.variantId));
  try {
    assert.equal((await set(input)).ok, false);
    await f.signIn("staff"); assert.equal((await set(input)).ok, false);
    const identity = await f.signIn();
    for (const patch of [{ reorderLevel: -1 }, { reorderLevel: 1.5 }, { reorderLevel: "12" }, { reorderLevel: 1000001 }, { variantId: "bad" }, { actorId: "fake" }]) assert.equal((await set({ ...input, ...patch })).ok, false);
    for (const patch of [{ variantId: crypto.randomUUID() }, { locationId: crypto.randomUUID() }]) assert.equal((await set({ ...input, ...patch })).ok, false);
    assert.equal((await balances()).length, 0);
    assert.deepEqual(await set(input), { ok: true });
    assert.equal((await balances())[0]?.onHand, 0); assert.equal((await balances())[0]?.reorderLevel, 12);
    const auditCount = await db.$count(schema.catalogAudit);
    assert.deepEqual(await set(input), { ok: true }); assert.equal(await db.$count(schema.catalogAudit), auditCount);
    const inventory = createInventory({ authorize: f.storage.authorize, apply: (query) => db.transaction(async (tx) => {
      await tx.execute(managementLock); return (await tx.execute<{ id: string }>(query)).rows[0]?.id;
    }) });
    assert.ok((await inventory.change({ requestId: crypto.randomUUID(), variantId: input.variantId, locationId: mainLocationId, type: "OPENING_STOCK", quantity: 10, reason: "Opening stock" })).ok);
    const stock = async (status: "all" | "low") => (await db.execute(stockQuery(identity, stockFilters.parse({ status })))).rows.find((r) => r.variantId === input.variantId);
    assert.equal((await stock("low"))?.onHand, 10);
    assert.ok((await set({ ...input, reorderLevel: 9 })).ok);
    assert.equal(await stock("low"), undefined); assert.equal((await stock("all"))?.onHand, 10);
    const locationId = crypto.randomUUID(); await db.insert(schema.inventoryLocations).values({ id: locationId, name: "Other stockroom" });
    assert.ok((await set({ ...input, locationId, reorderLevel: 30 })).ok);
    assert.equal((await balances()).find((b) => b.locationId === mainLocationId)?.reorderLevel, 9);
    assert.ok((await set({ ...input, reorderLevel: 0 })).ok); assert.equal((await stock("all"))?.reorderLevel, 0);
    await db.execute(sql`create function fail_reorder_audit() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end; $$`);
    await db.execute(sql`create trigger fail_reorder_audit before insert on catalog_audit for each row execute function fail_reorder_audit()`);
    assert.equal((await set({ ...input, reorderLevel: 99 })).ok, false); assert.equal((await stock("all"))?.reorderLevel, 0);
    await db.execute(sql`drop trigger fail_reorder_audit on catalog_audit`);
    const stale = createReorderSettings({ authorize: async () => ({ ...identity, staff: { id: identity.user.id, role: "admin", active: true } }), change });
    await db.update(schema.user).set({ role: "staff" }).where(eq(schema.user.id, identity.user.id));
    assert.equal((await stale(input)).ok, false);
    assert.equal(await db.$count(schema.inventoryMovements), 1);
    assert.equal((await balances()).find((b) => b.locationId === mainLocationId)?.onHand, 10);
  } finally { await client.close(); }
});
