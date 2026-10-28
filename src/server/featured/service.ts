import "server-only";
import { asc, sql } from "drizzle-orm";
import { currentPermissionSessionConditions, getPermissionSession } from "@/server/auth/authorize";
import { getDb } from "@/server/db";
import { featuredItems, session, user } from "@/server/db/schema";
import { managementLock } from "@/server/admin/queries";
import { featuredItemsInput, type FeaturedItem } from "./contracts";

export async function listFeaturedItems() {
  return getDb().select({
    id: featuredItems.id,
    slot: featuredItems.slot,
    eyebrow: featuredItems.eyebrow,
    title: featuredItems.title,
    description: featuredItems.description,
    imageUrl: featuredItems.imageUrl,
    imageAlt: featuredItems.imageAlt,
    ctaLabel: featuredItems.ctaLabel,
    href: featuredItems.href,
    active: featuredItems.active,
  }).from(featuredItems).orderBy(asc(featuredItems.slot));
}

export async function saveFeaturedItems(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = featuredItemsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the featured content and try again." };
  const identity = await getPermissionSession("promotions:write");
  if (!identity) return { ok: false, error: "Access denied. Sign in with an authorized account." };

  const values = sql.join(parsed.data.map((item) => sql`(
    ${item.slot}, ${item.eyebrow}, ${item.title}, ${item.description}, ${item.imageUrl},
    ${item.imageAlt}, ${item.ctaLabel}, ${item.href}, ${item.active}
  )`), sql`, `);
  const actor = sql`select ${user.id} from ${session} inner join ${user} on ${user.id} = ${session.userId}
    where ${currentPermissionSessionConditions(identity, "promotions:write", sql`clock_timestamp()`)}
    for update of ${user}, ${session}`;
  const write = sql`with actor as materialized (${actor}), saved as (
    insert into ${featuredItems} (slot, eyebrow, title, description, image_url, image_alt, cta_label, href, active)
    select input.slot, input.eyebrow, input.title, input.description, input.image_url, input.image_alt, input.cta_label, input.href, input.active
    from (values ${values}) as input(slot, eyebrow, title, description, image_url, image_alt, cta_label, href, active)
    where exists (select 1 from actor)
    on conflict (slot) do update set eyebrow = excluded.eyebrow, title = excluded.title,
      description = excluded.description, image_url = excluded.image_url, image_alt = excluded.image_alt,
      cta_label = excluded.cta_label, href = excluded.href, active = excluded.active, updated_at = clock_timestamp()
    returning slot
  ) select exists(select 1 from actor) as authorized, count(*)::int as saved from saved`;

  try {
    const db = getDb();
    const [, result] = await db.batch([db.execute(managementLock), db.execute<{ authorized: boolean; saved: number }>(write)]);
    const row = result.rows[0];
    if (!row?.authorized) return { ok: false, error: "Your access changed. Refresh and sign in again." };
    if (row.saved !== 3) return { ok: false, error: "All three featured slots must be saved. Refresh and try again." };
    return { ok: true };
  } catch (error) {
    const databaseError = error && typeof error === "object" ? error as { code?: unknown; constraint?: unknown; message?: unknown } : {};
    const code = typeof databaseError.code === "string" ? databaseError.code : undefined;
    const constraint = typeof databaseError.constraint === "string" ? databaseError.constraint : undefined;
    console.error("Featured content save failed", {
      code,
      constraint,
      message: typeof databaseError.message === "string" ? databaseError.message : "Unknown database error",
    });

    if (constraint === "featured_items_image_https") {
      return { ok: false, error: "Use an HTTPS image URL from Vercel Blob. Social media post links are not direct image URLs." };
    }
    if (constraint === "featured_items_internal_href") {
      return { ok: false, error: "Use an internal store link beginning with /, such as /shop." };
    }
    if (code === "42P01" || code === "42703") {
      return { ok: false, error: "The production database is missing part of the Featured content migration. Check migration 0011_featured_content." };
    }
    return { ok: false, error: code
      ? `Featured content could not be saved (database error ${code}). Refresh the page and retry; if it continues, contact support with this code.`
      : "Featured content could not be saved because of a database error. Refresh the page and retry." };
  }
}

export function publicFeaturedItems(items: Awaited<ReturnType<typeof listFeaturedItems>>): FeaturedItem[] {
  return items.filter((item) => item.active).map((item) => ({ ...item })) as FeaturedItem[];
}
