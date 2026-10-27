import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { catalogFixture } from "./catalog-fixture";
import { guestInput } from "../src/server/commerce/guest-contracts";
import { guestWrite, shopQuery } from "../src/server/commerce/guest";
import { commerceWrite, orderDetailQuery } from "../src/server/commerce/queries";
import { movementsQuery } from "../src/server/inventory/queries";
import { stockFilters } from "../src/server/inventory/contracts";
import { managementLock } from "../src/server/admin/queries";

const contact = { name: "Guest Buyer", email: "guest@example.test", phone: "09123456789", address: "Davao City delivery address" };
test("guest input rejects injected privileges, prices, bad contacts and duplicate lines", () => {
  const input = { action: "order.guest", contact, items: [{ variantId: crypto.randomUUID(), quantity: 1 }], notes: "", promotionCode: "" };
  assert.equal(guestInput.safeParse(input).success, true);
  for (const extra of [{ customerId: crypto.randomUUID() }, { locationId: crypto.randomUUID() }, { total: 1 }, { action: "order.pay" }]) assert.equal(guestInput.safeParse({ ...input, ...extra }).success, false);
  for (const change of [{ email: "bad" }, { phone: "" }, { address: "" }]) assert.equal(guestInput.safeParse({ ...input, contact: { ...contact, ...change } }).success, false);
  assert.equal(guestInput.safeParse({ ...input, items: [input.items[0], input.items[0]] }).success, false);
  assert.equal(guestInput.safeParse({ ...input, items: [{ ...input.items[0], quantity: 11 }] }).success, false);
});

test("guest orders require no account, preserve contacts, reserve atomically and remain staff managed", async t => {
  const f = await catalogFixture(); const { db, client, schema } = f;
  try {
    const staff = await f.signIn("super_admin");
    await db.update(schema.products).set({ status: "active" });
    const rows = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) => (await db.execute<T>(query)).rows;
    const location = (await rows<{ id: string }>(sql`select id from inventory_locations limit 1`))[0]!.id;
    const vid = f.data.variants[0]!.id;
    await db.execute(sql`select inventory_apply(${crypto.randomUUID()}::uuid,${vid}::uuid,${location}::uuid,'PURCHASE',10,'Guest test receipt','fixture',null,${staff.user.id})`);
    await db.insert(schema.customers).values({ ...contact, name: "Original profile", address: "Original address" });
    const input = guestInput.parse({ action: "order.guest", contact, items: [{ variantId: vid, quantity: 2 }], notes: "Guest notes", promotionCode: "" });
    const submit = async (request: string, data = input, rateKey = "guest:test") => db.transaction(async tx => {
      await tx.execute(managementLock);
      return (await tx.execute<{ id: string }>(guestWrite(request, data, rateKey))).rows[0]?.id;
    });
    const request = crypto.randomUUID();
    await t.test("shop cards expose catalog metadata and prefer variant photos without duplicating stock", async () => {
      const productId = f.data.variants[0]!.productId;
      await db.insert(schema.productImages).values([
        { productId, blobUrl: "https://example.test/product.jpg", altText: "Product photo", isPrimary: true },
        { productId, variantId: vid, blobUrl: "https://example.test/variant.jpg", altText: "Variant photo", isPrimary: true },
      ]);
      const publicItems = await rows(shopQuery);
      const item = publicItems.find(i => i.id === vid)!;
      assert.equal(item.imageUrl, "https://example.test/variant.jpg");
      assert.equal(item.imageAlt, "Variant photo");
      assert.equal(item.available, 10);
      assert.equal(publicItems.filter(i => i.id === vid).length, 1);
      assert.equal(typeof item.brand, "string");
      assert.equal(typeof item.category, "string");
      assert.equal(typeof item.featured, "boolean");
      assert.equal(typeof item.newArrival, "boolean");
      assert.equal("cost" in item, false);
      await db.execute(sql`delete from product_images where variant_id=${vid}::uuid`);
      assert.equal((await rows(shopQuery)).find(i => i.id === vid)!.imageUrl, "https://example.test/product.jpg");
    });
    await t.test("public projection excludes costs and prices are calculated by server", async () => {
      const publicItems = await rows(shopQuery);
      assert.ok(publicItems.length > 0); assert.equal("cost" in publicItems[0]!, false);
      assert.equal(await submit(request), request);
      const order = (await rows(sql`select * from orders where id=${request}::uuid`))[0]!;
      const movements = await rows<{ actor: string; reference: string }>(movementsQuery(staff, stockFilters.parse({ locationId: location })));
      assert.ok(movements.some(m => m.actor === "Guest checkout" && m.reference === request));
      assert.equal(order.actor_id, null); assert.equal(order.status, "pending"); assert.equal(order.payment_status, "unpaid");
      assert.equal(order.total, f.data.variants[0]!.price * 2); assert.deepEqual(order.customer_snapshot, contact);
      assert.equal((await rows(sql`select name from customers where email=${contact.email}`))[0]!.name, "Original profile");
      assert.equal((await rows(sql`select count(*)::int n from "user"`))[0]!.n, 1, "No customer authentication account created");
    });
    await t.test("retry does not duplicate order or reserve twice, changed request is rejected", async () => {
      assert.equal(await submit(request), request);
      await assert.rejects(submit(request, { ...input, notes: "changed" }));
      const b = (await rows(sql`select reserved from inventory_balances where variant_id=${vid}::uuid and location_id=${location}::uuid`))[0]!;
      assert.equal(b.reserved, 2);
    });
    await t.test("out of stock and invalid promotions roll back every change", async () => {
      const before = await rows(sql`select count(*)::int n from orders`);
      await assert.rejects(submit(crypto.randomUUID(), { ...input, items: [{ variantId: vid, quantity: 10 }] }));
      await assert.rejects(submit(crypto.randomUUID(), { ...input, promotionCode: "INVALID" }));
      assert.deepEqual(await rows(sql`select count(*)::int n from orders`), before);
    });
    await t.test("matching an email never grants access to old orders or changes profile", async () => {
      const id = crypto.randomUUID();
      await submit(id, { ...input, contact: { ...contact, name: "Another recipient", address: "Another address" } });
      assert.equal((await rows(sql`select name from customers where email=${contact.email}`))[0]!.name, "Original profile");
      assert.equal((await rows<{ customer_snapshot: typeof contact }>(sql`select customer_snapshot from orders where id=${id}::uuid`))[0]!.customer_snapshot.name, "Another recipient");
    });
    await t.test("contact throttle and shared persistent rate limit apply", async () => {
      await submit(crypto.randomUUID());
      await assert.rejects(submit(crypto.randomUUID()));
      await db.execute(sql`insert into rate_limit(id,key,count,last_request) values ('guest:limited','guest:limited',10,(extract(epoch from clock_timestamp())*1000)::bigint)`);
      assert.equal(await submit(crypto.randomUUID(), { ...input, contact: { ...contact, email: "other@example.test", phone: "09999999999" } }, "guest:limited"), undefined);
    });
    await t.test("new guests get contact records, promotions and shipping; cancellation releases stock", async () => {
      const nextContact = { ...contact, email: "new@example.test", phone: "09876543210" };
      await db.execute(sql`insert into store_settings(id,name,email,phone,address,shipping_fee) values(1,'Store','store@example.test','','Davao',15000)`);
      await db.execute(sql`insert into promotions(code,kind,amount,minimum,starts_at,ends_at,usage_limit) values('GUEST10','percent',10,0,now()-interval '1 day',now()+interval '1 day',10)`);
      const id = crypto.randomUUID();
      await submit(id, { ...input, contact: nextContact, promotionCode: "GUEST10", items: [{ variantId: vid, quantity: 1 }] }, "guest:new");
      const order = (await rows(sql`select subtotal,discount,shipping_fee,total from orders where id=${id}::uuid`))[0]!;
      assert.equal(order.discount, Math.floor(f.data.variants[0]!.price / 10));
      assert.equal(order.total, f.data.variants[0]!.price - Number(order.discount) + 15000);
      assert.equal((await rows(sql`select count(*)::int n from customers where email=${nextContact.email}`))[0]!.n, 1);
      const before = (await rows(sql`select reserved from inventory_balances where variant_id=${vid}::uuid and location_id=${location}::uuid`))[0]!.reserved;
      await db.execute(commerceWrite(staff, crypto.randomUUID(), { action: "order.cancel", id }));
      assert.equal((await rows(sql`select reserved from inventory_balances where variant_id=${vid}::uuid and location_id=${location}::uuid`))[0]!.reserved, Number(before) - 1);
      assert.equal((await rows(sql`select used from promotions where code='GUEST10'`))[0]!.used, 0);
      await db.execute(sql`update product_variants set status='inactive' where id=${vid}::uuid`);
      await assert.rejects(submit(crypto.randomUUID(), { ...input, contact: { ...nextContact, email: "failed@example.test" } }));
      assert.equal((await rows(sql`select count(*)::int n from customers where email='failed@example.test'`))[0]!.n, 0, "Customer insert rolls back on invalid item");
      await db.execute(sql`update product_variants set status='active' where id=${vid}::uuid`);
    });
    await t.test("staff can pay and fulfill guest orders; guest cannot invoke admin transitions", async () => {
      await assert.rejects(db.execute(sql`select commerce_execute(null,${crypto.randomUUID()}::uuid,${JSON.stringify({ action: "order.pay", id: request, reference: "fake payment" })}::jsonb)`));
      await db.execute(commerceWrite(staff, crypto.randomUUID(), { action: "order.pay", id: request, reference: "GCash received 123" }));
      await db.execute(commerceWrite(staff, crypto.randomUUID(), { action: "order.fulfill", id: request }));
      const detail = (await rows<{ status: string; history: { actor: string }[] }>(orderDetailQuery(staff, request)))[0]!;
      assert.equal(detail.status, "fulfilled"); assert.ok(detail.history.some(h => h.actor === "Guest checkout"));
    });
  } finally { await client.close(); }
});
