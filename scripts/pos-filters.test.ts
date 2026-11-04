import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { filterPosProducts } from "../src/lib/pos/filters";
import type { PosProduct } from "../src/server/pos/contracts";
import { posProductsQuery } from "../src/server/pos/queries";
import { catalogFixture } from "./catalog-fixture";
import { mainLocationId } from "../src/server/inventory/contracts";

const products: PosProduct[] = [
 {id:"1",name:"Control Paddle",sku:"PAD-1",barcode:"00123",price:100,imageUrl:null,imageAlt:null,categoryId:"paddles",categoryName:"Paddles",brandId:"joola",brandName:"Joola",stock:{main:2}},
 {id:"2",name:"Power Paddle",sku:"PAD-2",barcode:null,price:200,imageUrl:null,imageAlt:null,categoryId:"paddles",categoryName:"Paddles",brandId:"selkirk",brandName:"Selkirk",stock:{main:3}},
 {id:"3",name:"Paddle Bag",sku:"BAG-1",barcode:"00456",price:300,imageUrl:null,imageAlt:null,categoryId:"bags",categoryName:"Bags",brandId:"joola",brandName:"Joola",stock:{main:4}},
];
const ids=(search="",categoryId="",brandId="")=>filterPosProducts(products,{search,categoryId,brandId}).map(p=>p.id);

test("POS category, brand and search filters combine without changing the catalog",()=>{
 assert.deepEqual(ids(),["1","2","3"]);
 assert.deepEqual(ids("","paddles"),["1","2"]);
 assert.deepEqual(ids("","","joola"),["1","3"]);
 assert.deepEqual(ids("","paddles","joola"),["1"]);
 assert.deepEqual(ids(" POWER ","paddles","selkirk"),["2"]);
 assert.deepEqual(ids("pad-1","paddles","joola"),["1"]);
 assert.deepEqual(ids("00123","paddles","joola"),["1"]);
 assert.deepEqual(ids("00123","paddles","selkirk"),[]);
 assert.deepEqual(ids("","bags","selkirk"),[]);
 assert.equal(products.length,3);
 assert.equal(products[0]?.stock.main,2);
});

test("POS query returns category/brand metadata and preserves stock and access checks",async()=>{
 const f=await catalogFixture();
 try {
  const identity=await f.signIn("admin");
  const variant=f.data.variants[0]!;
  await f.db.insert(f.schema.inventoryBalances).values({variantId:variant.id,locationId:mainLocationId,onHand:7,reserved:2});
  const rows=(await f.db.execute<PosProduct & Record<string,unknown>>(posProductsQuery(identity))).rows;
  const row=rows.find(p=>p.id===variant.id);assert.ok(row);
  const source=f.data.products.find(p=>p.id===variant.productId)!;
  assert.equal(row.categoryId,source.categoryId);
  assert.equal(row.brandId,source.brandId);
  assert.equal(row.brandName,f.data.brands.find(b=>b.id===source.brandId)?.name);
  assert.equal(row.categoryName,f.data.categories.find(c=>c.id===source.categoryId)?.name);
  assert.equal(row.stock[mainLocationId],5);
  assert.equal(rows.filter(p=>p.id===variant.id).length,1);
  assert.equal("cost" in row,false);
  await f.db.delete(f.schema.session).where(eq(f.schema.session.id,identity.session.id));
  assert.equal((await f.db.execute(posProductsQuery(identity))).rows.length,0);
 } finally {await f.client.close();}
});
