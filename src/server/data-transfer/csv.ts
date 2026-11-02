import "server-only";

export function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.length === 0) quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(cell);
  if (row.some((v) => v !== "")) rows.push(row);
  return rows;
}

export function makeCsv(rows: Array<Array<string | number | null | undefined>>) {
  return rows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(",")).join("\r\n") + "\r\n";
}

export const productColumns = ["product_slug", "product_name", "description", "short_description", "brand", "category", "product_status", "featured", "new_arrival", "sku", "barcode", "price_cents", "compare_at_price_cents", "cost_cents", "currency", "variant_status"];
export const inventoryColumns = ["sku", "location_id", "target_on_hand", "reason", "reference"];
export const csvTemplates = {
  products: makeCsv([productColumns]),
  inventory: makeCsv([inventoryColumns]),
};
