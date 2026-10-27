"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { normalizeSlug } from "@/server/catalog/contracts";
import { createOptionInput, type CatalogOption, type OptionKind } from "@/server/catalog/option-contracts";
import { createProductOption } from "./actions";

// Uses buttons rather than a nested form so it also works inside ProductForm.
export function OptionCreator({ kind, onCreated }: { kind: OptionKind; onCreated?: (option: CatalogOption) => void }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  function create() {
    if (pending) return;
    const parsed = createOptionInput.safeParse({ name, slug });
    if (!parsed.success) { setMessage("Enter a name and a valid slug."); return; }
    setMessage("");
    startTransition(async () => {
      try {
        const result = await createProductOption(kind, parsed.data);
        if (!result.ok) { setMessage(result.error); return; }
        onCreated?.(result.option);
        setOpen(false); setName(""); setSlug(""); setSlugEdited(false);
        setMessage(`${kind === "brand" ? "Brand" : "Category"} created: ${result.option.name}.`);
        router.refresh();
      } catch { setMessage("Creation not confirmed. Check the available options before retrying."); }
    });
  }
  return <div className="space-y-2 text-sm">
    <button type="button" disabled={pending} aria-expanded={open} aria-controls={id} className="underline underline-offset-4" onClick={() => { setOpen(!open); setMessage(""); }}>Add {kind}</button>
    {open && <fieldset id={id} onKeyDown={(event) => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); create(); } }} disabled={pending} className="space-y-3 rounded-md border p-3">
      <legend className="px-1">New {kind}</legend>
      <label className="block">Name<input value={name} maxLength={160} className="mt-1 block w-full rounded-md border bg-background p-2" onChange={(e) => { setName(e.target.value); if (!slugEdited) setSlug(normalizeSlug(e.target.value)); }} /></label>
      <label className="block">Slug<input value={slug} maxLength={180} className="mt-1 block w-full rounded-md border bg-background p-2" onChange={(e) => { setSlugEdited(true); setSlug(e.target.value); }} onBlur={() => setSlug(normalizeSlug(slug))} /></label>
      <p className="text-xs text-muted-foreground">Created as active and available for products immediately.</p>
      <div className="flex gap-4"><button type="button" onClick={create} className="rounded-md bg-primary px-3 py-2 text-primary-foreground">{pending ? "Creating…" : `Create ${kind}`}</button>
        <button type="button" onClick={() => setOpen(false)} className="underline">Cancel</button></div>
    </fieldset>}
    {message && <p role="status">{message}</p>}
  </div>;
}
