"use server";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db";
import { managementLock } from "@/server/admin/queries";
import { guestInput, type CheckoutResult } from "@/server/commerce/guest-contracts";
import { guestWrite } from "@/server/commerce/guest";
export async function placeGuestOrder(request: unknown, input: unknown): Promise<CheckoutResult> {
  const parsed = guestInput.safeParse(input);
  if (!z.uuid().safeParse(request).success || !parsed.success) return { ok: false, error: "Check your items, name, email, contact number and delivery address." };
  try {
    const h = await headers();
    // Vercel supplies this header; outside Vercel use a shared limit rather than trusting arbitrary forwarded IPs.
    const source = process.env.VERCEL ? h.get("x-vercel-forwarded-for") ?? "unknown" : "local";
    const rateKey = `guest:${createHash("sha256").update(source).digest("hex")}`;
    const db = getDb();
    const [, result] = await db.batch([db.execute(managementLock), db.execute<{ id: string }>(guestWrite(request as string, parsed.data, rateKey))]);
    const id = result.rows[0]?.id;
    if (!id) return { ok: false, error: "Too many checkout attempts. Try again in 10 minutes." };
    // No public order lookup: only this matching, successful submission receives its total.
    const order = (await db.execute<{ total: number }>(sql`select total from orders where id=${id}::uuid`)).rows[0];
    if (!order) throw Error("Missing order");
    return { ok: true, id, total: order.total };
  } catch {
    return { ok: false, error: "Unable to place your order. Check available stock and promotion code, or try again later. Contact the store if you have already placed three orders this hour." };
  }
}
