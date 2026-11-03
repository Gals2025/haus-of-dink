"use client";
import { useState } from "react";
import { commitTransfer, previewTransfer } from "./actions";
import type { PriceUnit } from "@/lib/data-transfer/prices";

type Kind = "products" | "inventory";
export function ImportPanel({ kind }: { kind: Kind }) {
  const [text, setText] = useState("");
  const [batchId, setBatchId] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [priceUnit, setPriceUnit] = useState<PriceUnit>("centavos");
  async function validate(value: string, unit: PriceUnit) {
    const result = await previewTransfer(kind, value, unit);
    setReady(result.ok); setErrors(result.errors);
    if (result.ok) {
      const example = kind === "products" && result.firstPriceCents
        ? ` First row selling price: ${result.currency} ${(Number(result.firstPriceCents) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
        : "";
      setMessage(`${result.count} row${result.count === 1 ? "" : "s"} validated.${example} Review your file, then confirm the import.`);
    }
  }
  async function changeUnit(unit: PriceUnit) {
    setPriceUnit(unit); setReady(false); setErrors([]); setMessage("");
    if (!text) return;
    setPending(true);
    try { await validate(text, unit); }
    catch { setErrors(["Could not validate the file. Please choose it again."]); }
    finally { setPending(false); }
  }
  async function choose(file?: File) {
    setErrors([]); setReady(false); setMessage(""); setText(""); setBatchId("");
    if (!file) return;
    if (!/\.(csv|xls|xlsx)$/i.test(file.name) || file.size > 500_000) { setErrors(["Choose a CSV, XLS or XLSX file no larger than 500 KB."]); return; }
    setPending(true);
    try {
      const value = /\.csv$/i.test(file.name)
        ? await file.text()
        : (await import("@/lib/data-transfer/spreadsheet")).spreadsheetToCsv(await file.arrayBuffer());
      setText(value); setBatchId(crypto.randomUUID());
      await validate(value, priceUnit);
    } catch (error) { setErrors([error instanceof Error ? error.message : "Could not read or validate the uploaded file."]); }
    finally { setPending(false); }
  }
  async function confirm() {
    setPending(true); setErrors([]); setMessage("");
    try {
      const result = await commitTransfer(kind, text, batchId, priceUnit);
      setMessage(`${result.succeeded} row${result.succeeded === 1 ? "" : "s"} imported; ${result.failed} failed.`);
      setErrors(result.errors); setReady(false); setText(""); setBatchId("");
    } catch { setErrors(["Import did not complete. Check the data before retrying."]); }
    finally { setPending(false); }
  }
  return <section className="space-y-3 rounded-xl border bg-card p-5">
    <h2 className="text-xl">Import {kind}</h2>
    {kind === "products" && <div className="space-y-2">
      <label className="block text-sm">Prices in file
        <select value={priceUnit} disabled={pending} onChange={(event) => void changeUnit(event.target.value as PriceUnit)} className="ml-2 rounded-md border bg-background p-2">
          <option value="centavos">Centavos (exported files)</option>
          <option value="pesos">Pesos (e.g. 14,995.00)</option>
        </select>
      </label>
      <p className="text-sm text-muted-foreground">Keep the template column names. Choose Pesos for regular prices such as 14,995.00; choose Centavos for unchanged exports (1499500 means PHP 14,995.00). Commas and .00 formatting are accepted.</p>
    </div>}
    <label className="block text-sm">Choose completed CSV or Excel template<input type="file" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={pending} onChange={(event) => void choose(event.target.files?.[0])} className="mt-2 block w-full text-sm" /></label>
    {message && <p aria-live="polite" className="text-sm">{message}</p>}
    {errors.length > 0 && <ul role="alert" className="list-inside list-disc space-y-1 text-sm text-destructive">{errors.slice(0, 30).map((error, i) => <li key={`${i}-${error}`}>{error}</li>)}</ul>}
    {ready && <button type="button" disabled={pending} onClick={() => void confirm()} className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60">{pending ? "Importing…" : "Confirm import"}</button>}
  </section>;
}
