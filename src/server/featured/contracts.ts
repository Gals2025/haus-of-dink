import { z } from "zod";

const imageUrl = z.string().trim().max(2000).refine(
  (value) => value === "" || (z.url().safeParse(value).success && value.startsWith("https://")),
  "Image URL must use HTTPS.",
).transform((value) => value || null);

export const featuredItemsInput = z.array(z.strictObject({
  slot: z.number().int().min(1).max(3),
  eyebrow: z.string().trim().max(100),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500),
  imageUrl,
  imageAlt: z.string().trim().max(240),
  ctaLabel: z.string().trim().min(1).max(80),
  href: z.string().trim().min(1).max(500).regex(/^\/(?!\/)/, "Use an internal store link beginning with /.")
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Link contains invalid characters."),
  active: z.boolean(),
})).length(3).refine((items) => new Set(items.map((item) => item.slot)).size === 3, "Configure each of the three featured slots once.");

export type FeaturedItem = z.infer<typeof featuredItemsInput>[number] & { id?: string };

export const defaultFeaturedItems: FeaturedItem[] = [
  { slot: 1, eyebrow: "PLAY YOUR WAY", title: "Find your paddle", description: "Explore paddles made for your next great game.", imageUrl: null, imageAlt: "A featured pickleball paddle", ctaLabel: "Shop paddles", href: "/shop", active: true },
  { slot: 2, eyebrow: "COURT ESSENTIALS", title: "Game day ready", description: "The little things that keep every rally rolling.", imageUrl: null, imageAlt: "Pickleball court accessories", ctaLabel: "Shop accessories", href: "/shop", active: true },
  { slot: 3, eyebrow: "THE LATEST DROP", title: "Fresh gear, fresh energy", description: "Meet the newest additions to the Haus of Dink.", imageUrl: null, imageAlt: "New Haus of Dink pickleball gear", ctaLabel: "Explore the shop", href: "/shop", active: true },
];
