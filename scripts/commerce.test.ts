import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { catalogFixture } from "./catalog-fixture";
import { createCommerce } from "../src/server/commerce/service";
import { commerceWrite, commerceList, reportQuery, orderDetailQuery } from "../src/server/commerce/queries";
import { commerceInput,parsePesos } from "../src/server/commerce/contracts";
import { managementLock } from "../src/server/admin/queries";
import { hasPermission } from "../src/server/auth/authorize";

test("commerce contracts reject malformed prices, dates, duplicate lines and over-broad permissions",()=>{
  assert.equal(parsePesos("15.25"),1525);assert.equal(parsePesos("0.01"),1);assert.ok(Number.isNaN(parsePesos("1.234")));
  for(const permission of ["orders:write","customers:read","promotions:write","reports:read","settings:write"]) assert.equal(hasPermission("staff",permission),false);
  assert.equal(hasPermission("admin","settings:write"),false);assert.equal(hasPermission("super_admin","settings:write"),true);
  assert.equal(commerceInput.safeParse({action:"order.fulfill",id:"bad"}).success,false);
  const line={variantId:crypto.randomUUID(),quantity:1};
  assert.equal(commerceInput.safeParse({action:"order.create",customerId:crypto.randomUUID(),locationId:crypto.randomUUID(),promotionCode:"",notes:"",items:[line,line]}).success,false);
  const promotion={action:"promotion.save",code:"TEST",kind:"percent",amount:101,minimum:0,startsAt:"2026-01-01T00:00:00Z",endsAt:"2026-02-01T00:00:00Z",usageLimit:1,active:true};
  assert.equal(commerceInput.safeParse(promotion).success,false);
  assert.equal(commerceInput.safeParse({...promotion,amount:10,endsAt:promotion.startsAt}).success,false);
});

test("orders, customers, promotions, settings and reports commit atomically with live permissions",async(t)=>{
  const f=await catalogFixture();const {db,client,schema}=f;
  try {
    const identity=await f.signIn("super_admin");
    const write=async(query:ReturnType<typeof commerceWrite>)=>db.transaction(async tx=>{await tx.execute(managementLock);return (await tx.execute<{id:string}>(query)).rows[0]?.id;});
    const save=createCommerce({authorize:f.storage.authorize,write});
    async function mutate(input:unknown,request=crypto.randomUUID()) {const r=await save(request,input);assert.ok(r.ok,JSON.stringify(r));return r.id;}
    const rows=async<T>(query:ReturnType<typeof sql>)=>(await db.execute<T & Record<string,unknown>>(query)).rows;
    const customerInput={action:"customer.save",name:"Customer",email:"BUYER@example.test",phone:"0900",address:"Davao",active:true};
    const cid=await mutate(customerInput);
    const vid=f.data.variants[0]!.id,vid2=f.data.variants[1]!.id;
    const location=(await rows<{id:string}>(sql`select id from inventory_locations limit 1`))[0]!.id;
    await db.update(schema.products).set({status:"active"});
    await db.execute(sql`select inventory_apply(${crypto.randomUUID()}::uuid,${vid}::uuid,${location}::uuid,'PURCHASE',10,'Test receipt','fixture',null,${identity.user.id})`);
    await db.execute(sql`select inventory_apply(${crypto.randomUUID()}::uuid,${vid2}::uuid,${location}::uuid,'PURCHASE',10,'Test receipt','fixture',null,${identity.user.id})`);
    await mutate({action:"settings.save",name:"Dink Store",email:"store@example.test",phone:"",address:"Davao",shippingFee:15000});
    const pid=await mutate({action:"promotion.save",code:"SAVE10",kind:"percent",amount:10,minimum:0,startsAt:new Date(Date.now()-86400000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),usageLimit:2,active:true});
    const create={action:"order.create",customerId:cid,locationId:location,promotionCode:"SAVE10",notes:"Test order",items:[{variantId:vid,quantity:2},{variantId:vid2,quantity:1}]};
    const balance=async()=> (await rows<{on_hand:number;reserved:number}>(sql`select on_hand,reserved from inventory_balances where variant_id=${vid}::uuid and location_id=${location}::uuid`))[0]!;
    let oid="";
    await t.test("creation reserves stock, snapshots prices and contacts, calculates promo/shipping, and retries once",async()=>{
      const request=crypto.randomUUID();oid=await mutate(create,request);assert.equal(await mutate(create,request),oid);
      const order=(await rows<{subtotal:number;discount:number;shipping_fee:number;total:number;customer_snapshot:{email:string}}>(sql`select * from orders where id=${oid}::uuid`))[0]!;
      const expected=f.data.variants[0]!.price*2+f.data.variants[1]!.price;
      assert.equal(order.subtotal,expected);assert.equal(order.discount,Math.floor(expected/10));assert.equal(order.shipping_fee,15000);assert.equal(order.total,expected-Math.floor(expected/10)+15000);assert.equal(order.customer_snapshot.email,"buyer@example.test");
      assert.deepEqual(await balance(),{on_hand:10,reserved:2});
      assert.equal((await rows<{used:number}>(sql`select used from promotions where id=${pid}::uuid`))[0]!.used,1);
      assert.equal((await save(request,{...create,notes:"different"})).ok,false);
    });
    await t.test("insufficient second SKU rolls back order, promotion count, and all reservations",async()=>{
      const failed=await save(crypto.randomUUID(),{...create,items:[{variantId:vid,quantity:1},{variantId:vid2,quantity:99}]});assert.equal(failed.ok,false);
      assert.deepEqual(await balance(),{on_hand:10,reserved:2});
      assert.equal((await rows<{count:number}>(sql`select count(*)::int as count from orders`))[0]!.count,1);
      assert.equal((await rows<{used:number}>(sql`select used from promotions where id=${pid}::uuid`))[0]!.used,1);
    });
    await t.test("unpaid fulfillment fails; payment then fulfillment sells reserved quantities exactly once",async()=>{
      assert.equal((await save(crypto.randomUUID(),{action:"order.fulfill",id:oid})).ok,false);
      await mutate({action:"order.pay",id:oid,reference:"GCash received 001"});
      assert.equal((await save(crypto.randomUUID(),{action:"order.cancel",id:oid})).ok,false);
      const request=crypto.randomUUID();await mutate({action:"order.fulfill",id:oid},request);await mutate({action:"order.fulfill",id:oid},request);
      assert.deepEqual(await balance(),{on_hand:8,reserved:0});
      assert.equal((await save(crypto.randomUUID(),{action:"order.cancel",id:oid})).ok,false);
      const detail=(await rows<{items:unknown[];history:unknown[]}>(orderDetailQuery(identity,oid)))[0]!;assert.equal(detail.items.length,2);assert.equal(detail.history.length,3);
    });
    await t.test("paid pending cancellation requires recorded refund and restores reservation/code usage",async()=>{
      const second=await mutate(create);assert.equal((await save(crypto.randomUUID(),create)).ok,false,"usage limit enforced");
      await mutate({action:"order.pay",id:second,reference:"Cash receipt 002"});
      assert.equal((await save(crypto.randomUUID(),{action:"order.cancel",id:second})).ok,false);
      await mutate({action:"order.refund",id:second,reference:"Cash refund 002"});await mutate({action:"order.cancel",id:second});
      assert.deepEqual(await balance(),{on_hand:8,reserved:0});
      assert.equal((await rows<{used:number}>(sql`select used from promotions where id=${pid}::uuid`))[0]!.used,1);
    });
    await t.test("archived and inactive SKUs can release existing reservations",async()=>{
      const third=await mutate({...create,promotionCode:"",items:[{variantId:vid,quantity:1}]});
      await db.execute(sql`update product_variants set status='inactive' where id=${vid}::uuid`);
      await db.execute(sql`update products set status='archived' where id=(select product_id from product_variants where id=${vid}::uuid)`);
      await mutate({action:"order.cancel",id:third});assert.deepEqual(await balance(),{on_hand:8,reserved:0});
      assert.equal((await save(crypto.randomUUID(),create)).ok,false);
      await db.execute(sql`update product_variants set status='active' where id=${vid}::uuid`);await db.update(schema.products).set({status:"active"});
    });
    await t.test("sales report excludes cancelled and pending orders, keeps creation snapshots",async()=>{
      await db.update(schema.productVariants).set({price:1,cost:1,compareAtPrice:null});
      await mutate({...customerInput,id:cid,name:"Changed customer"});
      const today=new Date().toISOString().slice(0,10);
      const report=(await rows<{orders:number;cancelled:number;daily:{orders:number}[];revenue:string}>(reportQuery(identity,"2020-01-01","2030-01-01")))[0]!;
      assert.equal(report.orders,3);assert.equal(report.cancelled,2);assert.equal(report.daily.reduce((s,d)=>s+d.orders,0),1);assert.ok(Number(report.revenue)>1);assert.ok(today);
      const detail=(await rows<{customer:string}>(orderDetailQuery(identity,oid)))[0]!;assert.equal(detail.customer,"Customer");
    });
    await t.test("duplicate contacts, inactive customers, expired promotions and immutable audit are enforced",async()=>{
      assert.equal((await save(crypto.randomUUID(),customerInput)).ok,false);
      await mutate({...customerInput,id:cid,active:false});assert.equal((await save(crypto.randomUUID(),create)).ok,false);
      await mutate({...customerInput,id:cid,active:true});
      await mutate({action:"promotion.save",id:pid,code:"SAVE10",kind:"percent",amount:10,minimum:0,startsAt:"2020-01-01T00:00:00Z",endsAt:"2020-01-02T00:00:00Z",usageLimit:2,active:true});assert.equal((await save(crypto.randomUUID(),create)).ok,false);
      await assert.rejects(db.execute(sql`delete from commerce_audit`));await assert.rejects(db.execute(sql`truncate commerce_audit`));
    });
    await t.test("statement-time revalidation denies stale revoked sessions for writes and reads",async()=>{
      await db.execute(sql`update "user" set role='staff' where id=${identity.user.id}`);
      // Call SQL directly to simulate an identity that passed preflight before revocation.
      const denied=await write(commerceWrite(identity,crypto.randomUUID(),commerceInput.parse(customerInput)));assert.equal(denied,undefined);
      const result=(await rows<{authorized:boolean;rows:unknown[]}>(commerceList(identity,"customers",{search:"",page:1,status:"all"})))[0]!;assert.equal(result.authorized,false);assert.deepEqual(result.rows,[]);
      assert.equal((await save(crypto.randomUUID(),customerInput)).ok,false);
    });
  } finally {await client.close();}
});
