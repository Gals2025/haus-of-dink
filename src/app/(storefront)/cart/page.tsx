import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { getShop } from "@/server/commerce/guest";
import { CartContents } from "./cart-contents";
export const metadata:Metadata={title:"Your cart"};
async function Contents() {await connection();const {items}=await getShop();return <CartContents items={items}/>;}
export default function CartPage() {
 return <div className="mx-auto max-w-3xl space-y-5 px-4 py-8 sm:px-6"><h1 className="text-3xl">Your cart</h1><Suspense fallback={<p role="status">Loading your cart…</p>}><Contents/></Suspense></div>;
}
