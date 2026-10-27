"use client";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { normalizeSlug } from "@/server/catalog/contracts";
import type { EntityKind, ManagedEntity, ManagementData } from "@/server/catalog/management-contracts";
import { saveCatalogEntity, removeCatalogEntity } from "./actions";

const labels = { category: "Categories", brand: "Brands", attribute: "Attributes", value: "Attribute values" };
const keys = { category: "categories", brand: "brands", attribute: "attributes", value: "values" } as const;
const control = "mt-1 block w-full rounded-md border bg-background p-2";
export function CatalogManager({ data, canWrite }: { data: ManagementData; canWrite: boolean }) {
  const [kind, setKind] = useState<EntityKind>("category");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ManagedEntity | null | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<ManagedEntity | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const rows = data[keys[kind]].filter((r) => `${r.name} ${r.slug}`.toLowerCase().includes(search.toLowerCase()));
  function remove() {
    if (!confirm || pending) return;
    startTransition(async () => {
      try {
        const result = await removeCatalogEntity(kind, confirm.id);
        if (!result.ok) { setMessage(result.error); return; }
        setConfirm(null); setMessage("Record deleted."); router.refresh();
      } catch { setMessage("Deletion not confirmed. Refresh before retrying."); }
    });
  }
  return <div className="space-y-5">
    <nav aria-label="Catalog sections" className="flex flex-wrap gap-2">{(Object.keys(labels) as EntityKind[]).map((k) => <button type="button" key={k} disabled={pending} aria-pressed={kind === k} className={`rounded-md border px-4 py-2 ${kind === k ? "bg-primary text-primary-foreground" : "bg-card"}`} onClick={() => { setKind(k); setEditing(undefined); setConfirm(null); setMessage(""); }}>{labels[k]}</button>)}</nav>
    <div className="flex flex-wrap items-end gap-4"><label className="text-sm">Search {labels[kind].toLowerCase()}<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} className={control} /></label>
      {canWrite && <button type="button" disabled={pending} onClick={() => { setEditing(null); setMessage(""); }} className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Add {kind === "value" ? "attribute value" : kind}</button>}</div>
    {message && <p role="status">{message}</p>}
    {editing !== undefined && <EntityEditor key={`${kind}/${editing?.id ?? "new"}`} kind={kind} entity={editing} data={data} onCancel={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); setMessage("Saved successfully."); router.refresh(); }} />}
    {confirm && <section role="alertdialog" aria-modal="false" aria-labelledby="delete-title" className="space-y-3 rounded-lg border p-4"><h2 id="delete-title" className="font-medium">Delete {confirm.name}?</h2><p className="text-sm">Deletion is permanent and only allowed for unused records. Deactivate a brand or category to keep its existing product links.</p>
      <button type="button" disabled={pending} onClick={remove} className="mr-4 rounded-md bg-destructive px-4 py-2 text-white">{pending ? "Deleting…" : "Confirm deletion"}</button><button type="button" disabled={pending} onClick={() => setConfirm(null)} className="underline">Cancel</button></section>}
    <div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><caption className="sr-only">{labels[kind]}</caption><thead className="bg-muted"><tr>{["Name", "Slug", "Details", "References", "Actions"].map((h) => <th key={h} className="p-4" scope="col">{h}</th>)}</tr></thead><tbody>
      {rows.map((r) => <tr key={r.id} className="border-t"><td className="p-4 font-medium">{r.name}</td><td className="p-4">{r.slug}</td><td className="p-4"><p className="capitalize">{r.status ?? (kind === "value" ? data.attributes.find((a) => a.id === r.attributeId)?.name : r.unit || "—")}</p>{r.parentId && <p>Parent: {data.categories.find((c) => c.id === r.parentId)?.name}</p>}{r.description && <p className="max-w-sm truncate text-muted-foreground">{r.description}</p>}{r.websiteUrl && <a className="underline" href={r.websiteUrl} target="_blank" rel="noreferrer">Website</a>}{r.logoUrl && <a className="ml-3 underline" href={r.logoUrl} target="_blank" rel="noreferrer">Logo</a>}</td><td className="p-4">{r.usage}</td><td className="p-4 whitespace-nowrap">{canWrite && <><button type="button" disabled={pending} onClick={() => setEditing(r)} className="mr-4 underline">Edit</button><button type="button" disabled={pending || r.usage > 0} title={r.usage ? "Referenced records cannot be deleted" : undefined} onClick={() => { setConfirm(r); setMessage(""); }} className="underline disabled:opacity-40">Delete</button></>}</td></tr>)}
      {!rows.length && <tr><td colSpan={5} className="p-6 text-center">No matching records.</td></tr>}</tbody></table></div>
  </div>;
}
function EntityEditor({ kind, entity, data, onCancel, onSaved }: { kind: EntityKind; entity: ManagedEntity | null; data: ManagementData; onCancel: () => void; onSaved: () => void }) {
  const [slug, setSlug] = useState(entity?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(Boolean(entity));
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const f = new FormData(event.currentTarget);
    const text = (key: string) => String(f.get(key) ?? "").trim();
    const input = kind === "value" ? { value: text("name"), slug, attributeId: text("attributeId"), sortOrder: Number(text("sortOrder")) } : {
      name: text("name"), slug, description: text("description") || null,
      ...(kind === "attribute" ? { unit: text("unit") || null } : { status: text("status") }),
      ...(kind === "brand" ? { websiteUrl: text("websiteUrl") || null, logoUrl: text("logoUrl") || null } : {}),
      ...(kind === "category" ? { parentId: text("parentId") || null } : {}),
    };
    startTransition(async () => {
      try { const result = await saveCatalogEntity(kind, entity?.id ?? null, input); if (!result.ok) { setMessage(result.error); return; } onSaved(); }
      catch { setMessage("Save not confirmed. Refresh and check the list before retrying."); }
    });
  }
  // Exclude descendants from parent choices; the server independently checks cycles.
  const descendants = new Set(entity ? [entity.id] : []);
  let changed = true;
  while (changed) { changed = false; for (const c of data.categories) if (c.parentId && descendants.has(c.parentId) && !descendants.has(c.id)) { descendants.add(c.id); changed = true; } }
  return <form onSubmit={submit} className="rounded-xl border bg-card p-5"><fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2"><legend className="mb-3 text-xl">{entity ? "Edit" : "New"} {kind === "value" ? "attribute value" : kind}</legend>
    <label className="text-sm">Name<input required name="name" maxLength={kind === "attribute" ? 100 : 160} defaultValue={entity?.name} className={control} onChange={(e) => { if (!slugEdited) setSlug(normalizeSlug(e.target.value)); }} /></label>
    <label className="text-sm">Slug<input required maxLength={kind === "attribute" ? 120 : 180} value={slug} onChange={(e) => { setSlugEdited(true); setSlug(e.target.value); }} onBlur={() => setSlug(normalizeSlug(slug))} className={control} /></label>
    {kind !== "value" && <label className="text-sm sm:col-span-2">Description<textarea name="description" maxLength={20000} defaultValue={entity?.description ?? ""} className={control} /></label>}
    {(kind === "category" || kind === "brand") && <label className="text-sm">Status<select name="status" defaultValue={entity?.status ?? "active"} className={control}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>}
    {kind === "category" && <label className="text-sm">Parent category<select name="parentId" defaultValue={entity?.parentId ?? ""} className={control}><option value="">No parent</option>{data.categories.filter((c) => !descendants.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    {kind === "brand" && <><label className="text-sm">Website URL (HTTPS)<input type="url" name="websiteUrl" defaultValue={entity?.websiteUrl ?? ""} maxLength={2000} className={control} /></label><label className="text-sm">Logo URL (HTTPS)<input type="url" name="logoUrl" defaultValue={entity?.logoUrl ?? ""} maxLength={2000} className={control} /></label></>}
    {kind === "attribute" && <label className="text-sm">Unit (optional)<input name="unit" maxLength={30} defaultValue={entity?.unit ?? ""} className={control} /></label>}
    {kind === "value" && <><label className="text-sm">Attribute<select required name="attributeId" defaultValue={entity?.attributeId ?? ""} className={control}>{entity ? data.attributes.filter((a) => a.id === entity.attributeId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>) : <><option value="">Choose attribute</option>{data.attributes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</>}</select></label><label className="text-sm">Sort order<input name="sortOrder" type="number" min="0" step="1" defaultValue={entity?.sortOrder ?? 0} className={control} /></label></>}
    {message && <p role="alert" className="sm:col-span-2 text-destructive">{message}</p>}
    <div className="flex gap-4 sm:col-span-2"><button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">{pending ? "Saving…" : "Save"}</button><button type="button" onClick={onCancel} className="underline">Cancel</button></div>
  </fieldset></form>;
}
