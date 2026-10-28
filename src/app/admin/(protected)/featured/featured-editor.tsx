"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { FeaturedItem } from "@/server/featured/contracts";
import { saveFeaturedItems } from "./actions";

const field = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";

export function FeaturedEditor({ items, canWrite }: { items: FeaturedItem[]; canWrite: boolean }) {
  const [slides, setSlides] = useState(items.map((item) => ({ ...item })).sort((a, b) => a.slot - b.slot));
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState<number | null>(null);
  const router = useRouter();

  function change(slot: number, key: keyof FeaturedItem, value: string | boolean | null) {
    setSlides((current) => current.map((slide) => slide.slot === slot ? { ...slide, [key]: value } : slide));
  }

  async function uploadImage(slot: number, file: File) {
    setMessage("");
    if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setMessage("Choose an image under 10 MB (JPEG, PNG, WebP, or AVIF).");
      return;
    }
    setUploading(slot);
    try {
      const authorization = await fetch("/api/admin/featured/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type, size: file.size }),
      });
      const signed = await authorization.json() as { uploadUrl?: string; imageUrl?: string; error?: string };
      if (!authorization.ok || !signed.uploadUrl || !signed.imageUrl) {
        throw new Error(signed.error || "Could not prepare the image upload.");
      }
      const uploaded = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploaded.ok) throw new Error("Vercel Blob could not store this image. Try again or choose a smaller file.");
      change(slot, "imageUrl", signed.imageUrl);
      change(slot, "imageAlt", file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
      setMessage(`Image uploaded for slide ${slot}. Save featured content to publish it.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Image upload failed. Check the Blob configuration and try again.");
    } finally {
      setUploading(null);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    startTransition(async () => {
      try {
        const result = await saveFeaturedItems(slides.map((slide) => ({
          slot: slide.slot,
          eyebrow: slide.eyebrow,
          title: slide.title,
          description: slide.description,
          imageUrl: slide.imageUrl?.trim() || null,
          imageAlt: slide.imageAlt,
          ctaLabel: slide.ctaLabel,
          href: slide.href,
          active: slide.active,
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
        <fieldset key={slide.slot} disabled={pending || uploading !== null || !canWrite} className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2">
          <legend className="px-2 text-lg font-medium">Slide {slide.slot}</legend>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={slide.active} onChange={(event) => change(slide.slot, "active", event.target.checked)} />
            Show this slide in the storefront
          </label>
          <label>Eyebrow<input className={field} maxLength={100} value={slide.eyebrow} onChange={(event) => change(slide.slot, "eyebrow", event.target.value)} placeholder="FEATURED" /></label>
          <label>Headline<input required className={field} maxLength={160} value={slide.title} onChange={(event) => change(slide.slot, "title", event.target.value)} /></label>
          <label className="sm:col-span-2">Description<textarea className={field} rows={2} maxLength={500} value={slide.description} onChange={(event) => change(slide.slot, "description", event.target.value)} /></label>
          <div className="sm:col-span-2 space-y-3">
            <label className="block">Featured image<input className={`${field} file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5`} type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(slide.slot, file); event.currentTarget.value = ""; }} /></label>
            <p className="text-xs text-muted-foreground">JPEG, PNG, WebP, or AVIF. Maximum 10 MB.{uploading === slide.slot ? " Uploading…" : ""}</p>
            {slide.imageUrl && <div className="flex items-center gap-3"><Image src={slide.imageUrl} alt="" width={144} height={80} unoptimized className="h-20 w-36 rounded-md border object-cover" /><button type="button" className="text-sm underline" onClick={() => change(slide.slot, "imageUrl", null)}>Remove image</button></div>}
          </div>
          <label>Image description for accessibility<input className={field} maxLength={240} value={slide.imageAlt} onChange={(event) => change(slide.slot, "imageAlt", event.target.value)} /></label>
          <label>Button label (optional)<input className={field} maxLength={80} value={slide.ctaLabel} onChange={(event) => change(slide.slot, "ctaLabel", event.target.value)} /></label>
          <label className="sm:col-span-2">Store link (optional)<input className={field} maxLength={500} value={slide.href} onChange={(event) => change(slide.slot, "href", event.target.value)} placeholder="/shop" /><span className="mt-1 block text-xs text-muted-foreground">Optional. If provided, use an internal path beginning with /, such as /shop.</span></label>
        </fieldset>
      ))}
      {message && <p role="status" className="text-sm">{message}</p>}
      {canWrite ? <button disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{pending ? "Saving…" : "Save featured content"}</button> : <p className="text-sm text-muted-foreground">You have view access. A promotion manager can edit featured content.</p>}
    </form>
  );
}
