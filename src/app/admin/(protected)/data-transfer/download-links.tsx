"use client";

import { useState } from "react";

export function DownloadLinks({ kind }: { kind: "products" | "inventory" }) {
  const [format, setFormat] = useState("xlsx");
  const url = `/api/admin/data-transfer?kind=${kind}&format=${format}`;
  return <div className="space-y-3">
    <label className="block text-sm">Download format
      <select value={format} onChange={(event) => setFormat(event.target.value)} className="ml-2 rounded-md border bg-background p-2">
        <option value="xlsx">Excel (.xlsx)</option>
        <option value="xls">Excel 97–2003 (.xls)</option>
        <option value="csv">CSV (.csv)</option>
      </select>
    </label>
    <div className="flex flex-wrap gap-3">
      <a className="rounded-md border px-4 py-2 text-sm" href={`${url}&template=1`}>Download template</a>
      <a className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" href={url}>Export {kind}</a>
    </div>
  </div>;
}
