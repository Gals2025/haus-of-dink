import "server-only";

export { parseCsv } from "@/lib/data-transfer/csv";

export function makeCsv(rows: Array<Array<string | number | null | undefined>>) {
  return rows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(",")).join("\r\n") + "\r\n";
}

export const productColumns = ["product_slug", "product_name", "description", "short_description", "brand", "category", "product_status", "featured", "new_arrival", "sku", "barcode", "price_cents", "compare_at_price_cents", "cost_cents", "currency", "variant_status", "inventory_mode", "availability"];
export const inventoryColumns = ["sku", "location_id", "target_on_hand", "reason", "reference", "inventory_mode", "availability"];
export const csvTemplates = {
  products: makeCsv([productColumns]),
  inventory: makeCsv([inventoryColumns]),
};
