"use client";
import Link from "next/link";
import { ShoppingBag,Trash2 } from "lucide-react";
import { setCartQuantity,useCart } from "@/lib/cart/store";
import { peso } from "@/server/commerce/contracts";
import type { ShopCatalogItem } from "@/server/commerce/guest-contracts";
export function CartContents({items}:{items:ShopCatalogItem[]}) {
 const {lines,ready,count}=useCart();
 if(!ready)return <p role="status">Loading your cart…</p>;
 if(!lines.length)return <section className="rounded-xl border p-8 text-center"><ShoppingBag className="mx-auto mb-3 size-10 text-primary" aria-hidden="true"/><h2 className="text-xl">Your cart is empty</h2><Link href="/shop" className="mt-4 inline-block rounded-lg bg-primary px-5 py-3 text-primary-foreground">Browse the shop</Link></section>;
 const rows=lines.map(line=>({...line,item:items.find(item=>item.id===line.variantId)}));
 const invalid=rows.some(row=>!row.item||row.item.available<row.quantity);
 const subtotal=rows.reduce((sum,row)=>sum+(row.item?.price??0)*row.quantity,0);
 return <section className="space-y-5"><p>{count} {count===1?"item":"items"} in your cart</p><ul className="divide-y rounded-xl border bg-white px-4">{rows.map(row=><li key={row.variantId} className="flex gap-3 py-4"><div className="min-w-0 flex-1"><p className="font-medium">{row.item?.name??"Unavailable item"}</p>{row.item&&<p className="mt-1 text-sm text-muted-foreground">{row.item.sku} · {peso(row.item.price)} each</p>}
 <label className="mt-3 inline-flex items-center gap-2 text-sm">Quantity<select aria-label={`Quantity for ${row.item?.name??"unavailable item"}, ${row.item?.sku??""}`} value={row.quantity} disabled={!row.item||row.item.available<1} onChange={event=>setCartQuantity(row.variantId,Number(event.target.value),row.item?.available??0)} className="min-h-11 rounded-md border bg-background px-3">{row.quantity>(row.item?.available??0)&&<option value={row.quantity} disabled>{row.quantity} (unavailable)</option>}{Array.from({length:Math.min(10,row.item?.available??0)},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select></label>
 {(!row.item||row.item.available<row.quantity)&&<p className="mt-2 text-sm text-destructive">{row.item&&row.item.available>0?`Only ${row.item.available} currently available. Please reduce the quantity.`:"This item is no longer available. Please remove it before checkout."}</p>}</div><div className="text-right">{row.item&&<p className="font-semibold">{peso(row.item.price*row.quantity)}</p>}<button type="button" onClick={()=>setCartQuantity(row.variantId,0,0)} aria-label={`Remove ${row.item?.name??"unavailable item"}, ${row.item?.sku??""}`} className="mt-2 inline-flex min-h-11 items-center gap-2 px-2 text-sm text-destructive"><Trash2 className="size-4"/>Remove</button></div></li>)}</ul>
 <div className="flex justify-between text-lg font-semibold"><span>Subtotal</span><span>{peso(subtotal)}</span></div><p className="text-sm text-muted-foreground">Delivery fees and promotions are calculated at checkout. Prices and stock are checked again before your order is accepted.</p>
 {invalid&&<p role="alert" className="text-sm text-destructive">Update or remove unavailable items before proceeding.</p>}
 <div className="flex flex-wrap gap-3"><Link href="/shop" className="rounded-lg border px-5 py-3 text-sm">Continue shopping</Link>{invalid?<button disabled className="rounded-lg bg-primary px-5 py-3 text-sm text-primary-foreground opacity-50">Proceed to checkout</button>:<Link href="/checkout" className="rounded-lg bg-primary px-5 py-3 text-sm text-primary-foreground">Proceed to checkout</Link>}</div></section>;
}
