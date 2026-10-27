"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BadgeCheck, ChevronDown, CircleDot, Grid2X2, Package, Search, ShoppingBag, SlidersHorizontal, Sparkles, Tag, X } from "lucide-react";
import type { ShopCatalogItem } from "@/server/commerce/guest-contracts";
import { peso } from "@/server/commerce/contracts";

const inputClass = "w-full rounded-lg border border-[#dce3d8] bg-white min-h-11 min-w-0 px-3 py-2.5 text-base outline-none sm:text-sm focus-visible:ring-2 focus-visible:ring-primary";
const tabs = [{ id: "all", label: "All products" }, { id: "featured", label: "Featured" }, { id: "new", label: "New arrivals" }, { id: "sale", label: "On sale" }] as …3797 tokens truncated…

export function Brand() {
  return (
    <Link
      href="/"
      className="inline-flex flex-col items-start text-primary"
      aria-label="Haus of Dink home"
    >
      <span className="font-serif text-[1.35rem] sm:text-[1.75rem] leading-none tracking-tight">
        HAUS <span className="text-[0.7em] italic">of</span> DINK
      </span>
      <span className="mt-2 text-[0.5rem] sm:text-[0.55rem] font-bold tracking-[0.22em]">
        PICKLEBALL ESSENTIALS
      </span>
    </Link>
  );
}

