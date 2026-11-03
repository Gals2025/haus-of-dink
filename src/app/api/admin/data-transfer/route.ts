import { getPermissionSession } from "@/server/auth/authorize";
import { getDb } from "@/server/db";
import { makeCsv, productColumns, inventoryColumns } from "@/server/data-transfer/csv";
import { makeSpreadsheet } from "@/lib/data-transfer/spreadsheet";
import { transferExportQuery } from "@/server/data-transfer/queries";

const safe = (v: unknown) => {
  const value = String(v ?? "");
  return /^[=+@\-\t\r]/.test(value) ? `'${value}` : value;
};
export async function GET(request: Request) {
  const url = new URL(request.url), kind = url.searchParams.get("kind");
  if (kind !== "products" && kind !== "inventory") return new Response("Invalid export type", { status: 400 });
  const requestedFormat = url.searchParams.get("format") ?? "csv";
  if (requestedFormat !== "csv" && requestedFormat !== "xls" && requestedFormat !== "xlsx") return new Response("Invalid export format", { status: 400 });
  const format: "csv" | "xls" | "xlsx" = requestedFormat;
  const headers = kind === "products" ? productColumns : inventoryColumns;
  function download(rows: string[][], template: boolean) {
    const name = `hod-${kind}-${template ? "template" : "export"}.${format}`;
    if (format === "csv") return new Response(makeCsv(rows.map((row) => row.map(safe))), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=${name}`, "Cache-Control": "private, no-store" },
    });
    // BIFF8's row limit includes the header. Never silently truncate exports.
    if (format === "xls" && rows.length > 65_536) return new Response("Too many rows for XLS. Choose XLSX or CSV.", { status: 400 });
    const body = new Uint8Array(makeSpreadsheet(rows, format));
    return new Response(body, { headers: {
      "Content-Type": format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/vnd.ms-excel",
      "Content-Disposition": `attachment; filename=${name}`, "Cache-Control": "private, no-store",
    } });
  }
  if (url.searchParams.get("template") === "1") {
    return download([headers], true);
  }
  const identity = await getPermissionSession("inventory:read");
  if (!identity) return new Response("Access denied", { status: 403 });
  const query = transferExportQuery(kind, identity);
  const result = await getDb().execute<Record<string, unknown>>(query);
  const rows = result.rows.map((row) => headers.map((key) => String(row[key] ?? "")));
  return download([headers, ...rows], false);
}
