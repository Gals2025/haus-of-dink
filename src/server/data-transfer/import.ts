import "server-only";
import { parseCsv, productColumns, inventoryColumns } from "./csv";
import { normalizePrice, type PriceUnit } from "@/lib/data-transfer/prices";
type Kind = "products" | "inventory";
type Parsed = { rows: Record<string, string>[]; errors: string[] };
export function readTransfer(text: string, kind: Kind, priceUnit: PriceUnit = "centavos"): Parsed {
  try {
    if (priceUnit !== "centavos" && priceUnit !== "pesos") return { rows: [], errors: ["Choose a valid price unit."] };
    if (text.length > 500_000) return { rows: [], errors: ["File exceeds the 500 KB limit."] };
    const csv = parseCsv(text);
    const expected = kind === "products" ? productColumns : inventoryColumns;
    const headers = csv.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
    if (headers.join("|") !== expected.join("|") && headers.join("|") !== expected.slice(0,-2).join("|")) return { rows: [], errors: [`Template columns do not match. Download a fresh ${kind} template.`] };
    if (!csv.length) return { rows: [], errors: ["The template has no data rows."] };
    if (csv.length > 100) return { rows: [], errors: ["Upload up to 100 rows at a time."] };
    const errors: string[] = [];
    const rows = csv.map((values, index) => {
      if (values.length !== headers.length) errors.push(`Row ${index + 2}: expected ${headers.length} columns.`);
      const row: Record<string, string> = Object.fromEntries(headers.map((header, i) => [header, (values[i] ?? "").trim()]));
      for (const key of ["inventory_mode", "availability"]) row[key] = (row[key] ?? "").toLowerCase();
      if (row.inventory_mode && !["counted","availability_only"].includes(row.inventory_mode)) errors.push(`Row ${index+2}: inventory_mode must be counted or availability_only.`);
      if (row.availability && !["available","unavailable"].includes(row.availability)) errors.push(`Row ${index+2}: availability must be available or unavailable.`);
      if (kind === "inventory" && row.inventory_mode === "availability_only") errors.push(`Row ${index+2}: stock counting is disabled. Use product import or inventory settings to change availability.`);
      if (kind === "products") {
        for (const key of ["price_cents", "compare_at_price_cents", "cost_cents"]) {
          try { row[key] = normalizePrice(row[key] ?? "", priceUnit); }
          catch (error) { errors.push(`Row ${index + 2}, ${key}: ${error instanceof Error ? error.message : "Invalid price."}`); }
        }
        for (const key of ["product_status", "variant_status", "featured", "new_arrival"]) row[key] = (row[key] ?? "").toLowerCase();
      }
      return row;
    });
    return { rows, errors };
  } catch { return { rows: [], errors: ["CSV parsing failed. Check quotes and separators."] }; }
}
