import assert from "node:assert/strict";
import { test } from "node:test";
import { eq,sql } from "drizzle-orm";
import { catalogFixture } from "./catalog-fixture";
import { createLocationService,createStoreLocationQuery,listStoreLocationsQuery,locationInput,type LocationOutcome } from "../src/server/inventory/locations";
import { managementLock } from "../src/server/admin/queries";
import { posProductsQuery } from "../src/server/pos/queries";
import { stockQuery } from "../src/server/inventory/queries";
import { stockFilters,mainLocationId } from "../src/server/inventory/contracts";

test("location names require a nonblank bounded value",()=>{
 for(const input of [{name:""},{name:"   "},{name:"x".repeat(161)},{name:"Branch",id:crypto.randomUUID()},{}])assert.equal(locationInput.safeParse(input).success,false);
 assert.deepEqual(locationInput.parse({name:"  New stockroom  "}),{name:"New stockroom"});
});

test("administrators add audited locations usable by Inventory and POS without changing existing stock",async()=>{
 const f=await catalogFixture();
 try {
  const add=createLocationService({authorize:f.storage.authorize,change:query=>f.db.transaction(async tx=>{
    await tx.execute(managementLock);return (await tx.execute<LocationOutcome>(query)).rows[0];
  })});
  assert.equal((await add({name:"Unauthenticated"})).ok,false);
  const identity=await f.signIn("admin");
  const variant=f.data.variants[0]!;
  await f.db.execute(sql`select inventory_apply(${crypto.randomUUID()}::uuid,${variant.id}::uuid,${mainLocationId}::uuid,'PURCHASE',7,'Location test stock','',null,${identity.user.id})`);
  const before=await f.db.select().from(f.schema.inventoryBalances);
  const created=await add({name:"  Branch Two  "});assert.ok(created.ok);
  assert.equal(created.location.name,"Branch Two");assert.match(created.location.id,/^[0-9a-f-]{36}$/);
  assert.deepEqual(await f.db.select().from(f.schema.inventoryBalances),before);
  const listing=await f.db.execute(listStoreLocationsQuery(identity));
  assert.ok(listing.rows.some(row=>row.id===created.location.id&&row.name==="Branch Two"));
  const inventory=await f.db.execute(stockQuery(identity,stockFilters.parse({locationId:created.location.id})));
  assert.equal(inventory.rows.find(row=>row.variantId===variant.id)?.onHand,0);
  const pos=await f.db.execute(posProductsQuery(identity));
  assert.equal((pos.rows.find(row=>row.id===variant.id)?.stock as Record<string,number>)[created.location.id],0);
  const audits=await f.db.select().from(f.schema.commerceAudit);
  assert.equal(audits.filter(a=>a.action==="inventory.location.create").length,1);
  assert.equal(audits.find(a=>a.action==="inventory.location.create")?.entityId,created.location.id);
  const duplicate=await add({name:" branch TWO "});assert.ok(!duplicate.ok);assert.match(duplicate.error,/already exists/);
  assert.equal((await f.db.select().from(f.schema.inventoryLocations)).filter(row=>row.name==="Branch Two").length,1);
  // Under the shared management lock, concurrent duplicate submissions add one location.
  const concurrent=await Promise.all([add({name:"Warehouse"}),add({name:"warehouse"})]);
  assert.equal(concurrent.filter(result=>result.ok).length,1);
  await f.db.execute(sql`create function fail_location_audit() returns trigger language plpgsql as $$ begin raise exception 'Test audit failure'; end; $$`);
  await f.db.execute(sql`create trigger fail_location_audit before insert on commerce_audit for each row execute function fail_location_audit()`);
  assert.equal((await add({name:"Must roll back"})).ok,false);
  assert.equal((await f.db.select().from(f.schema.inventoryLocations)).some(row=>row.name==="Must roll back"),false);
  await f.db.execute(sql`drop trigger fail_location_audit on commerce_audit`);
  await f.db.delete(f.schema.session).where(eq(f.schema.session.id,identity.session.id));
  const stale=await f.db.execute<LocationOutcome>(createStoreLocationQuery(identity,"Stale access"));
  assert.equal(stale.rows[0]?.authorized,false);
  assert.equal((await f.db.select().from(f.schema.inventoryLocations)).some(row=>row.name==="Stale access"),false);
  await f.signIn("staff");assert.equal((await add({name:"Staff attempt"})).ok,false);
 } finally {await f.client.close();}
});
