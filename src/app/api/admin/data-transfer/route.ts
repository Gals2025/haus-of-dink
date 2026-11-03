import { sql } from "drizzle-orm";
import { getPermissionSession, currentPermissionSessionConditions } from "@/server/auth/authorize";
import { getDb } from "@/server/db";
import { makeCsv, productColumns, inventoryColumns } from "@/server/data-transfer/csv";
import { makeSpreadsheet } from "@/lib/data-transfer/spreadsheet";
import type { SQL } from "drizzle-orm";

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
  let query: SQL;
  if (kind === "products") query = sql`select p.slug as product_slug, p.name as product_name, p.description, p.short_description, b.name as brand, c.name as category, p.status as product_status, p.featured, p.new_arrival, v.sku, v.barcode, v.price as price_cents, v.compare_at_price as compare_at_price_cents, v.cost as cost_cents, v.currency, v.status as variant_status
    from products p join brands b on b.id=p.brand_id join categories c on c.id=p.category_id join product_variants v on v.product_id=p.id
    where exists(select 1 where ${currentPermissionSessionConditions(identity, "inventory:read", sql`clock_timestamp()`)}) order by p.name, v.sku`;
  else query = sql`select v.sku, l.id as location_id, coalesce(b.on_hand,0)::int as target_on_hand, '' as reason, '' as reference
    from product_variants v cross join inventory_locations l left join inventory_balances b on b.variant_id=v.id and b.location_id=l.id
    where exists(select 1 where ${currentPermissionSessionConditions(identity, "inventory:read", sql`clock_timestamp()`)}) order by l.name, v.sku`;
  const result = await getDb().execute<Record<string, unknown>>(query);
  const rows = result.rows.map((row) => headers.map((key) => String(row[key] ?? "")));
  return download([headers, ...rows], false);
}
