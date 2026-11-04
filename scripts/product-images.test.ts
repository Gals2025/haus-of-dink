import assert from "node:assert/strict";
import { test } from "node:test";
import { eq,sql } from "drizzle-orm";
import { catalogFixture } from "./catalog-fixture";
import { imageTargetQuery,saveProductImageQuery } from "../src/server/catalog/image-queries";
import { productImageInput,productImageUpload,maxProductImageSize } from "../src/server/catalog/image-contracts";
import { posProductsQuery } from "../src/server/pos/queries";
import type { PosProduct } from "../src/server/pos/contracts";
import { shopQuery } from "../src/server/commerce/guest";

const id="00000000-0000-4000-8000-000000000001";
const url=`https://teststore.public.blob.vercel-storage.com/product-images/${id}/${id}.jpg`;
test("product uploads accept supported images and reject untrusted URLs or oversized files",()=>{
 assert.ok(productImageUpload.safeParse({productId:id,contentType:"image/jpeg",size:100}).success);
 for(const change of [{contentType:"image/svg+xml"},{size:0},{size:maxProductImageSize+1},{productId:"bad"}]) assert.equal(productImageUpload.safeParse({productId:id,contentType:"image/jpeg",size:100,...change}).success,false);
 assert.ok(productImageInput.safeParse({productId:id,imageUrl:url,altText:"Paddle"}).success);
 for(const imageUrl of ["http://localhost/image.jpg",url.replace(".public.",".private."),url.replace("teststore.public.blob.vercel-storage.com","example.com"),`${url}?x=1`,url.replace(`/product-images/${id}/`,"/payment-proofs/"),url.replace(".jpg",".svg")]) assert.equal(productImageInput.safeParse({productId:id,imageUrl,altText:"Paddle"}).success,false);
 assert.equal(productImageInput.safeParse({productId:id,imageUrl:url,altText:" "}).success,false);
});

test("thumbnail updates are scoped, audited and selected consistently by POS/storefront",async()=>{
 const f=await catalogFixture();
 try {
  const identity=await f.signIn("admin");
  const variant=f.data.variants[0]!;const sibling=f.data.variants[1]!;
  const path=(productId:string)=>`https://teststore.public.blob.vercel-storage.com/product-images/${productId}/${crypto.randomUUID()}.jpg`;
  const save=async(variantId:string|null,imageUrl:string)=>f.db.execute<{saved:boolean}>(saveProductImageQuery(identity,{productId:variant.productId,variantId,imageUrl,altText:"Product thumbnail"}));
  const first=path(variant.productId); const replacement=path(variant.productId);const specific=path(variant.productId);
  assert.equal((await save(null,first)).rows[0]?.saved,true);
  assert.equal((await save(null,replacement)).rows[0]?.saved,true);
  let images=await f.db.select().from(f.schema.productImages).where(eq(f.schema.productImages.productId,variant.productId));
  assert.equal(images.length,2,"replacing a thumbnail preserves old gallery images");
  assert.equal(images.filter(i=>i.isPrimary).length,1);
  assert.equal(images.find(i=>i.isPrimary)?.blobUrl,replacement);
  assert.equal((await save(variant.id,specific)).rows[0]?.saved,true);
  const pos=(await f.db.execute<PosProduct & Record<string,unknown>>(posProductsQuery(identity))).rows;
  assert.equal(pos.find(p=>p.id===variant.id)?.imageUrl,specific);
  assert.equal(pos.find(p=>p.id===sibling.id)?.imageUrl,replacement);
  assert.equal(pos.filter(p=>p.id===variant.id).length,1,"images must not duplicate POS variants");
  const shop=(await f.db.execute(shopQuery)).rows;
  assert.equal(shop.find(p=>p.id===variant.id)?.imageUrl,specific);
  assert.equal(shop.find(p=>p.id===sibling.id)?.imageUrl,replacement);
  const audit=await f.db.select().from(f.schema.catalogAudit);
  assert.equal(audit.filter(a=>(a.changes as {fields?:string[]}).fields?.includes("images")).length,3);
  const wrongVariant=f.data.variants.find(v=>v.productId!==variant.productId)!;
  assert.equal((await f.db.execute(imageTargetQuery(identity,variant.productId,wrongVariant.id))).rows.length,0);
  assert.equal((await save(wrongVariant.id,path(variant.productId))).rows[0]?.saved,false);
  await f.db.execute(sql`create function fail_image_audit() returns trigger language plpgsql as $$ begin raise exception 'Test audit failure'; end; $$`);
  await f.db.execute(sql`create trigger fail_image_audit before insert on catalog_audit for each row execute function fail_image_audit()`);
  await assert.rejects(save(null,path(variant.productId)));
  const afterFailure=await f.db.select().from(f.schema.productImages).where(eq(f.schema.productImages.productId,variant.productId));
  assert.equal(afterFailure.length,3);
  assert.equal(afterFailure.find(image=>image.variantId===null&&image.isPrimary)?.blobUrl,replacement,"audit failure must preserve the old primary image");
  await f.db.delete(f.schema.session).where(eq(f.schema.session.id,identity.session.id));
  assert.equal((await save(null,path(variant.productId))).rows[0]?.saved,false);
  images=await f.db.select().from(f.schema.productImages).where(eq(f.schema.productImages.productId,variant.productId));
  assert.equal(images.length,3);
 } finally {await f.client.close();}
});
