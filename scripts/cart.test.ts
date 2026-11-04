import assert from "node:assert/strict";
import { test } from "node:test";
import { addCartLine,decodeCart,setCartLineQuantity,subtractPurchasedLines } from "../src/lib/cart/model";
import { addCartItem,setCartQuantity,completeCartPurchase } from "../src/lib/cart/store";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;

test("cart quantities respect stock, checkout limits and different SKUs",()=>{
 let cart=addCartLine([],id(1),2).lines;
 cart=addCartLine(cart,id(1),2).lines;
 assert.deepEqual(cart,[{variantId:id(1),quantity:2}]);
 assert.ok(addCartLine(cart,id(1),2).error);
 assert.ok(addCartLine(cart,id(2),0).error);
 assert.ok(addCartLine(cart,id(2),NaN).error);
 cart=addCartLine(cart,id(2),10).lines;
 assert.equal(cart.length,2);
 assert.equal(setCartLineQuantity(cart,id(2),99,100)[1]?.quantity,10);
 assert.equal(setCartLineQuantity(cart,id(2),4,3)[1]?.quantity,3);
 assert.deepEqual(setCartLineQuantity(cart,id(2),1.5,10),cart);
 assert.deepEqual(setCartLineQuantity(cart,id(1),0,0),[{variantId:id(2),quantity:1}]);
 const full=Array.from({length:30},(_,i)=>({variantId:id(i+1),quantity:1}));
 assert.ok(addCartLine(full,id(31),10).error);
 assert.equal(addCartLine(full,id(1),10).lines[0]?.quantity,2);
});

test("saved carts validate local storage and never trust saved prices",()=>{
 for(const input of ["invalid","null","{}",JSON.stringify(Array(31).fill({variantId:id(1),quantity:1}))]) assert.deepEqual(decodeCart(input),[]);
 const raw=JSON.stringify([{variantId:id(1),quantity:2,price:1,available:999},{variantId:"bad",quantity:1},{variantId:id(2),quantity:-1},{variantId:id(3),quantity:NaN},{variantId:id(1),quantity:1}]);
 assert.deepEqual(decodeCart(raw),[{variantId:id(1),quantity:3}]);
 assert.deepEqual(decodeCart(JSON.stringify([{variantId:id(1),quantity:11}])),[]);
});

test("successful checkout removes only purchased quantities and keeps later additions",()=>{
 const current=[{variantId:id(1),quantity:5},{variantId:id(2),quantity:2},{variantId:id(3),quantity:1}];
 assert.deepEqual(subtractPurchasedLines(current,[{variantId:id(1),quantity:3},{variantId:id(2),quantity:2}]),[{variantId:id(1),quantity:2},{variantId:id(3),quantity:1}]);
 assert.deepEqual(subtractPurchasedLines(current,[]),current);
 assert.deepEqual(subtractPurchasedLines([{variantId:id(1),quantity:1}],[{variantId:id(1),quantity:3}]),[]);
});

test("Add to Cart persists and notifies without navigation, with a memory fallback",()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,"window");
 const data=new Map<string,string>();
 let blocked=false,notifications=0;
 const browser=Object.assign(new EventTarget(),{location:{href:"/shop"},localStorage:{
   getItem:(key:string)=>data.get(key)??null,
   setItem:(key:string,value:string)=>{if(blocked)throw new Error("Storage quota exceeded");data.set(key,value);},
 }});
 Object.defineProperty(globalThis,"window",{value:browser,configurable:true});
 browser.addEventListener("haus-of-dink:cart-changed",()=>notifications++);
 try {
  addCartItem(id(1),10);addCartItem(id(1),10);
  assert.equal(browser.location.href,"/shop");
  assert.equal(notifications,2);
  assert.deepEqual(decodeCart(data.get("haus-of-dink-cart-v1")!),[{variantId:id(1),quantity:2}]);
  setCartQuantity(id(1),3,10);
  completeCartPurchase([{variantId:id(1),quantity:1}]);
  assert.deepEqual(decodeCart(data.get("haus-of-dink-cart-v1")!),[{variantId:id(1),quantity:2}]);
  blocked=true;
  assert.equal(addCartItem(id(1),10).lines[0]?.quantity,3);
  assert.equal(addCartItem(id(1),10).lines[0]?.quantity,4,"fallback cart must remain usable if localStorage writes fail");
 } finally {if(descriptor)Object.defineProperty(globalThis,"window",descriptor);else Reflect.deleteProperty(globalThis,"window");}
});
