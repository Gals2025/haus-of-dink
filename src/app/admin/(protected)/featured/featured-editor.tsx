"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FeaturedItem } from "@/server/featured/contracts";
import { saveFeaturedItems } from "./actions";

const field = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";

export function FeaturedEditor({ items, canWrite }: { items: FeaturedItem[]; canWrite: boolean }) {
  const [slides, setSlides] = useState(items.map((item) => ({ ...item })).sort((a, b) => a.slot - b.slot));
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const router = useRouter();

  function change(slot: number, key: keyof FeaturedItem, value: string | boolean | null) {
    setSlides((current) => current.map((slide) => slide.slot === slot ? { ...slide, [key]: value } : slide));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    startTransition(async () => {
      try {
        const result = await saveFeaturedItems(slides.map(({ id: _id, ...slide }) => ({
          ...slide,
          imageUrl: slide.imageUrl?.trim() || null,
        })));
        if (!result.ok) {
          setMessage(result.error);
          return;
        }
        setMessage("Featured content saved.");
        router.refresh();
      } catch {
        setMessage("Unable to confirm the save. Refresh before trying again.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {slides.map((slide) => (
        <fieldset key={slide.slot} disabled={pending || !canWrite} className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2">
          <legend className="px-2 text-lg font-medium">Slide {slide.slot}</legend>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={slide.active} onChange={(event) => change(slide.slot, "active", event.target.checked)} />
            Show this slide in the storefront
          </label>
          <label>Eyebrow<input className={field} maxLength={100} value={slide.eyebrow} onChange={(event) => change(slide.slot, "eyebrow", event.target.value)} placeholder="FEATURED" /></label>
          <label>Headline<input required className={field} maxLength={160} value={slide.title} onChange={(event) => change(slide.slot, "title", event.target.value)} /></label>
          <label className="sm:col-span-2">Description<textarea className={field} rows={2} maxLength={500} value={slide.description} onChange={(event) => change(slide.slot, "description", event.target.value)} /></label>
          <label className="sm:col-span-2">Image URL (HTTPS)<input className={field} type="url" maxLength={2000} value={slide.imageUrl ?? ""} onChange={(event) => change(slide.slot, "imageUrl", event.target.value || null)} placeholder="https://… (optional)" /></label>
          <label>Image description for accessibility<input className={field} maxLength={240} value={slide.imageAlt} onChange={(event) => change(slide.slot, "imageAlt", event.target.value)} /></label>
          <label>Button label<input required className={field} maxLength={80} value={slide.ctaLabel} onChange={(event) => change(slide.slot, "ctaLabel", event.target.value)} /></label>
          <label className="sm:col-span-2">Store link<input required className={field} maxLength={500} value={slide.href} onChange={(event) => change(slide.slot, "href", event.target.value)} placeholder="/shop" /><span className="mt-1 block text-xs text-muted-foreground">Use an internal path beginning with /, such as /shop or /shop?category=paddles.</span></label>
        </fieldset>
      ))}
      {message && <p role="status" className="text-sm">{message}</p>}
      {canWrite ? <button disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{pending ? "Saving…" : "Save featured content"}</button> : <p className="text-sm text-muted-foreground">You have view access. A promotion manager can edit featured content.</p>}
    </form>
  );
}
