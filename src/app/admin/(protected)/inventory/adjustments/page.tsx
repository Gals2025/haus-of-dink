import Link from "next/link";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requirePermission, currentPermissionSessionConditions } from "@/server/auth/authorize";
import { getDb } from "@/server/db";
import { productVariants, inventoryLocations, session, user } from "@/server/db/schema";
import { mainLocationId } from "@/server/inventory/contracts";
import { StockForm } from "../stock-form";

export default async function AdjustmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const identity = await requirePermission("inventory:write");
  const params = await searchParams;
  const parsed = z.object({ variantId: z.uuid(), locationId: z.uuid().default(mainLocationId) }).safeParse(params);
  if (!parsed.success) return <p>Select a SKU from <Link className="underline" href="/admin/inventory">inventory</Link> to record a movement.</p>;
  // Check current access for catalog identifiers too; never accept a caller's SKU label.
  const db = getDb();
  const [authorized] = await db.select({ id: user.id }).from(session).innerJoin(user, eq(user.id, session.userId)).where(currentPermissionSessionConditions(identity, "inventory:write")).limit(1);
  if (!authorized) return <p>Access denied. Sign in again.</p>;
  const [variant] = await db.select({ sku: productVariants.sku }).from(productVariants).where(eq(productVariants.id, parsed.data.variantId));
  const [location] = await db.select().from(inventoryLocations).where(eq(inventoryLocations.id, parsed.data.locationId));
  if (!variant || !location) return <p>SKU or location unavailable. Return to <Link href="/admin/inventory" className="underline">inventory</Link>.</p>;
  const requestId = randomUUID();
  return <div className="space-y-6"><Link className="text-sm underline" href={`/admin/inventory?locationId=${location.id}`}>Back to inventory</Link>
    <div><h1 className="text-4xl">Record stock movement</h1><p className="mt-3 text-muted-foreground">{location.name} · Enter the quantity moved, rather than a replacement balance.</p></div>
    <StockForm key={`${parsed.data.variantId}/${location.id}`} variantId={parsed.data.variantId} locationId={location.id} sku={variant.sku} requestId={requestId} />
  </div>;
}
