import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, sql } from "drizzle-orm";
import * as schema from "../src/server/db/schema";
import { developmentCatalog as data } from "./seed-data";
import { createInventory } from "../src/server/inventory/service";
import { applyStockQuery, stockQuery, movementsQuery } from "../src/server/inventory/queries";
import { stockChange, stockFilters, mainLocationId, type StockChange } from "../src/server/inventory/contracts";
import { createAuthorization, currentStaffSessionConditions, type AuthSession } from "../src/server/auth/authorize";
import { managementLock } from "../src/server/admin/queries";

test("inventory ledger, reservations, integrity and current authorization", async (t) => {
  const client = new PGlite(); const db = drizzle(client, { schema });
  let identity: AuthSession | null = null;
  const authorization = createAuthorization({ redirect: () => { throw new Error("Denied"); }, readSession: async () => identity,
    findStaff: async (who) => (await db.select({ id: schema.user.id, role: schema.user.role, active: schema.user.active }).from(schema.session)
      .innerJoin(schema.user, eq(schema.user.id, schema.session.userId)).where(currentStaffSessionConditions(who)).limit(1))[0],
  });
  const apply = async (query: ReturnType<typeof applyStockQuery>) => db.transaction(async (tx) => {
    await tx.execute(managementLock); return (await tx.execute<{ id: string }>(query)).rows[0]?.id;
  });
  const api = createInventory({ authorize: authorization.getPermissionSession, apply });
  const variant = data.variants[0]!.id;
  const input = (type: StockChange["type"], quantity: number, extra: Partial<StockChange> = {}) => stockChange.parse({
    requestId: crypto.randomUUID(), variantId: variant, locationId: mainLocationId, type, quantity, reason: "Test movement", ...extra,
  });
  async function signIn(role: "staff" | "admin" | "super_admin") {
    const id = crypto.randomUUID(); const now = new Date();
    const [user] = await db.insert(schema.user).values({ id, email: `${id}@example.test`, name: "Inventory tester", role, active: true }).returning();
    const [session] = await db.insert(schema.session).values({ id, token: crypto.randomUUID(), userId: id, expiresAt: new Date(now.getTime() + 3600000) }).returning();
    assert.ok(user && session); identity = { user, session }; return identity;
  }
  const balance = async () => (await db.select().from(schema.inventoryBalances).where(sql`${schema.inventoryBalances.variantId} = ${variant} AND ${schema.inventoryBalances.locationId} = ${mainLocationId}`))[0]!;
  const movementCount = () => db.$count(schema.inventoryMovements);
  try {
    await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
    await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
    await db.insert(schema.brands).values(data.brands); await db.insert(schema.categories).values(data.categories);
    await db.insert(schema.products).values(data.products); await db.insert(schema.productVariants).values(data.variants);
    await t.test("unauthenticated/staff cannot mutate; staff may read; all mutation types require permission", async () => {
      assert.equal((await api.change(input("PURCHASE", 1))).ok, false);
      const staff = await signIn("staff");
      for (const type of ["PURCHASE", "RESERVATION", "SALE", "ADJUSTMENT_OUT", "RESERVATION_RELEASE"] as const) {
        assert.equal((await api.change(input(type, 1, { reference: "ORDER-1", ...(type === "RESERVATION_RELEASE" ? { reservationId: crypto.randomUUID() } : {}) }))).ok, false);
      }
      assert.equal((await db.execute(stockQuery(staff, stockFilters.parse({})))).rows.length, data.variants.length);
      assert.equal(await movementCount(), 0);
    });
    await t.test("opening, purchasing and idempotent retries record one audited movement", async () => {
      await signIn("admin");
      const opening = input("OPENING_STOCK", 10);
      const first = await api.change(opening); assert.ok(first.ok);
      assert.deepEqual(await api.change(opening), first);
      assert.equal(await movementCount(), 1);
      await assert.rejects(api.change({ ...opening, quantity: 11 }));
      await assert.rejects(api.change(input("OPENING_STOCK", 1)));
      assert.ok((await api.change(input("PURCHASE", 5))).ok);
      assert.equal((await balance()).onHand, 15);
    });
    let reservationId: string;
    await t.test("reservation reduces availability; direct sale cannot consume reserved stock", async () => {
      const reserve = input("RESERVATION", 12, { reference: "ORDER-001" }); reservationId = reserve.requestId;
      assert.ok((await api.change(reserve)).ok); assert.ok((await api.change(reserve)).ok);
      assert.equal((await balance()).reserved, 12);
      await assert.rejects(api.change(input("SALE", 4)));
      assert.ok((await api.change(input("SALE", 3))).ok);
      assert.equal((await balance()).onHand, 12);
      await assert.rejects(api.change(input("RESERVATION", 1, { reference: "ORDER-002" })));
    });
    await t.test("reserved sale and partial release track remaining; over-release and wrong SKU fail", async () => {
      assert.ok((await api.change(input("SALE", 5, { reservationId }))).ok);
      assert.ok((await api.change(input("RESERVATION_RELEASE", 3, { reservationId }))).ok);
      assert.equal((await balance()).onHand, 7); assert.equal((await balance()).reserved, 4);
      await assert.rejects(api.change(input("RESERVATION_RELEASE", 5, { reservationId })));
      await assert.rejects(api.change(input("SALE", 1, { reservationId, variantId: data.variants[1]!.id })));
      assert.ok((await api.change(input("RESERVATION_RELEASE", 4, { reservationId }))).ok);
      await assert.rejects(api.change(input("RESERVATION_RELEASE", 1, { reservationId })));
      assert.equal((await balance()).reserved, 0);
    });
    await t.test("returns, adjustments, damage, loss and cancelled-sale restock reconcile", async () => {
      for (const type of ["RETURN", "ADJUSTMENT_IN", "CANCELLED_ORDER_RESTOCK"] as const) assert.ok((await api.change(input(type, 2))).ok);
      for (const type of ["ADJUSTMENT_OUT", "DAMAGED", "LOST"] as const) assert.ok((await api.change(input(type, 1))).ok);
      assert.equal((await balance()).onHand, 10);
      const rows = await db.select().from(schema.inventoryMovements);
      assert.equal(rows.reduce((n, m) => n + m.afterOnHand - m.beforeOnHand, 0), 10);
      assert.equal(rows.reduce((n, m) => n + m.afterReserved - m.beforeReserved, 0), 0);
      assert.ok(rows.every((m) => m.actorId && m.reason && m.createdAt));
    });
    await t.test("competing requests cannot oversell (serialized in-memory adapter)", async () => {
      const results = await Promise.allSettled([api.change(input("SALE", 8)), api.change(input("SALE", 8))]);
      assert.equal(results.filter((r) => r.status === "fulfilled" && r.value.ok).length, 1);
      assert.equal((await balance()).onHand, 2);
    });
    await t.test("invalid inputs, unknown locations and variants make no changes", async () => {
      const before = await movementCount();
      for (const change of [null, {}, { ...input("PURCHASE", 1), quantity: -1 }, { ...input("PURCHASE", 1), quantity: 1.5 },
        { ...input("PURCHASE", 1), reason: " " }, { ...input("PURCHASE", 1), actorId: "forged" }, { ...input("PURCHASE", 1), type: "RESERVATION_RELEASE" }]) {
        assert.equal((await api.change(change)).ok, false);
      }
      await assert.rejects(api.change(input("PURCHASE", 1, { variantId: crypto.randomUUID() })));
      await assert.rejects(api.change(input("PURCHASE", 1, { locationId: crypto.randomUUID() })));
      assert.equal(await movementCount(), before);
    });
    await t.test("location balances are independent; opening is first per SKU/location", async () => {
      const id = crypto.randomUUID(); await db.insert(schema.inventoryLocations).values({ id, name: "Second stockroom" });
      assert.ok((await api.change(input("OPENING_STOCK", 20, { locationId: id }))).ok);
      assert.equal((await db.select().from(schema.inventoryBalances).where(eq(schema.inventoryBalances.locationId, id)))[0]?.onHand, 20);
      assert.equal((await balance()).onHand, 2);
    });
    await t.test("search escaping, stock filters and history pagination", async () => {
      assert.ok(identity);
      assert.equal((await db.execute(stockQuery(identity, stockFilters.parse({ search: "%' OR true --" })))).rows.length, 0);
      assert.equal((await db.execute(stockQuery(identity, stockFilters.parse({ status: "out" })))).rows.length, data.variants.length - 1);
      assert.equal((await db.execute(stockQuery(identity, stockFilters.parse({ page: 2 })))).rows.length, 0);
      assert.ok((await db.execute(movementsQuery(identity, stockFilters.parse({})))).rows.length > 0);
    });
    await t.test("expired, revoked, inactive and demoted actors are rechecked at database boundary", async () => {
      for (const reason of ["expired", "revoked", "inactive", "demoted"] as const) {
        const stale = await signIn("admin");
        if (reason === "expired") await db.update(schema.session).set({ expiresAt: new Date(0) }).where(eq(schema.session.id, stale.session.id));
        if (reason === "revoked") await db.delete(schema.session).where(eq(schema.session.id, stale.session.id));
        if (reason === "inactive") await db.update(schema.user).set({ active: false }).where(eq(schema.user.id, stale.user.id));
        if (reason === "demoted") await db.update(schema.user).set({ role: "staff" }).where(eq(schema.user.id, stale.user.id));
        assert.equal(await apply(applyStockQuery(stale, input("PURCHASE", 1))), undefined);
        assert.equal((await api.change(input("PURCHASE", 1))).ok, false);
      }
    });
    await t.test("ledger failure rolls back balance and reservation; history and referenced catalog are protected", async () => {
      await signIn("super_admin");
      await client.exec("CREATE FUNCTION fail_inventory_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'history unavailable'; END; $$; CREATE TRIGGER fail_inventory_test BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION fail_inventory_test();");
      await assert.rejects(api.change(input("PURCHASE", 1)));
      const reservation = input("RESERVATION", 1, { reference: "ROLLBACK" });
      await assert.rejects(api.change(reservation));
      assert.equal((await balance()).onHand, 2); assert.equal((await balance()).reserved, 0);
      assert.equal(await db.$count(schema.inventoryReservations, eq(schema.inventoryReservations.id, reservation.requestId)), 0);
      await client.exec("DROP TRIGGER fail_inventory_test ON inventory_movements");
      for (const query of [sql`update inventory_movements set reason = 'edited'`, sql`delete from inventory_movements`, sql`truncate inventory_movements`]) await assert.rejects(db.execute(query));
      await assert.rejects(db.delete(schema.productVariants).where(eq(schema.productVariants.id, variant)));
      await assert.rejects(db.update(schema.inventoryBalances).set({ onHand: -1 }));
    });
  } finally { await client.close(); }
});
