"use client";
import { useState } from "react";
import { commitTransfer, previewTransfer } from "./actions";

type Kind = "products" | "inventory";
export function ImportPanel({ kind }: { kind: Kind }) {
  const [text, setText] = useState("");
  const [batchId, setBatchId] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  async function choose(file?: File) {
    setErrors([]); setReady(false); setMessage("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv") || file.size > 500_000) { setErrors(["Choose a CSV file smaller than 500 KB."]); return; }
    setPending(true);
    try {
      const value = await file.text(); setText(value); setBatchId(crypto.randomUUID());
      const result = await previewTransfer(kind, value);
      setReady(result.ok); setErrors(result.errors);
      if (result.ok) setMessage(`${result.count} row${result.count === 1 ? "" : "s"} validated. Review your file, then confirm the import.`);
    } catch { setErrors(["Could not read or validate the uploaded file."]); }
    finally { setPending(false); }
  }
  async function confirm() {
    setPending(true); setErrors([]); setMessage("");
    try {
      const result = await commitTransfer(kind, text, batchId);
      setMessage(`${result.succeeded} row${result.succeeded === 1 ? "" : "s"} imported; ${result.failed} failed.`);
      setErrors(result.errors); setReady(false); setText(""); setBatchId("");
    } catch { setErrors(["Import did not complete. Check the data before retrying."]); }
    finally { setPending(false); }
  }
  return <section className="space-y-3 rounded-xl border bg-card p-5">
    <h2 className="text-xl">Import {kind}</h2>
    <label className="block text-sm">Choose completed CSV template<input type="file" accept=".csv,text/csv" disabled={pending} onChange={(event) => void choose(event.target.files?.[0])} className="mt-2 block w-full text-sm" /></label>
    {message && <p aria-live="polite" className="text-sm">{message}</p>}
    {errors.length > 0 && <ul role="alert" className="list-inside list-disc space-y-1 text-sm text-destructive">{errors.slice(0, 30).map((error, i) => <li key={`${i}-${error}`}>{error}</li>)}</ul>}
    {ready && <button type="button" disabled={pending} onClick={() => void confirm()} className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60">{pending ? "Importing…" : "Confirm import"}</button>}
  </section>;
}
