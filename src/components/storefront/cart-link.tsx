"use client";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useCart } from "@/lib/cart/store";
export function CartLink() {
  const {count}=useCart();
  return <Link href="/cart" className="checkout-link" aria-label={`Cart, ${count} ${count===1?"item":"items"}`}><ShoppingBag aria-hidden="true" className="size-5"/><span>Cart <span aria-live="polite">({count})</span></span></Link>;
}
