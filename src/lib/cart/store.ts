"use client";
import { useMemo,useSyncExternalStore } from "react";
import { addCartLine,decodeCart,setCartLineQuantity,subtractPurchasedLines,type CartLine } from "./model";
const key="haus-of-dink-cart-v1";
const eventName="haus-of-dink:cart-changed";
let fallback="[]";
let memoryOnly=false;
function snapshot() {
  if(typeof window==="undefined") return "[]";
  if(memoryOnly)return fallback;
  try {return window.localStorage.getItem(key)??"[]";} catch {return fallback;}
}
function subscribe(listener:()=>void) {
  const storage=(event:StorageEvent)=>{if(event.key===key||event.key===null)listener();};
  window.addEventListener(eventName,listener);window.addEventListener("storage",storage);
  return ()=>{window.removeEventListener(eventName,listener);window.removeEventListener("storage",storage);};
}
function write(lines:CartLine[]) {
  fallback=JSON.stringify(lines);
  try {window.localStorage.setItem(key,fallback);memoryOnly=false;} catch {memoryOnly=true;}
  window.dispatchEvent(new Event(eventName));
}
export function addCartItem(variantId:string,available:number) {
  const result=addCartLine(decodeCart(snapshot()),variantId,available);
  if(!result.error)write(result.lines);
  return result;
}
export function ensureCartItem(variantId:string,available:number) {
  if(!decodeCart(snapshot()).some(line=>line.variantId===variantId))addCartItem(variantId,available);
}
export function setCartQuantity(variantId:string,quantity:number,available:number) {
  write(setCartLineQuantity(decodeCart(snapshot()),variantId,quantity,available));
}
export function completeCartPurchase(purchased:CartLine[]) {
  write(subtractPurchasedLines(decodeCart(snapshot()),purchased));
}
export function useCart() {
  const raw=useSyncExternalStore(subscribe,snapshot,()=>"[]");
  const ready=useSyncExternalStore(subscribe,()=>true,()=>false);
  const lines=useMemo(()=>decodeCart(raw),[raw]);
  return {lines,ready,count:lines.reduce((sum,line)=>sum+line.quantity,0)};
}
