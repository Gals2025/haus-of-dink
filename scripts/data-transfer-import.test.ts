import assert from "node:assert/strict";
import { test } from "node:test";
import { read, write } from "@e965/xlsx";
import { makeSpreadsheet, spreadsheetToCsv } from "../src/lib/data-transfer/spreadsheet";
import { normalizePrice } from "../src/lib/data-transfer/prices";
import { readTransfer } from "../src/server/data-transfer/import";
import { makeCsv, productColumns } from "../src/server/data-transfer/csv";

const row = ["paddle", "Paddle", "", "", "Brand", "Category", "Active", "TRUE", "FALSE", "00123", "000456", "14,995.00", "", "165.90", "PHP", "Active"];

for (const format of ["xls", "xlsx"] as const) {
  test(`${format}: formatted peso prices and mixed-case statuses import correctly`, () => {
    const workbook = read(makeSpreadsheet([productColumns, row], format), { type: "array" });
    const sheet = workbook.Sheets.Data!;
    // Match spreadsheet numeric cells formatted with thousands and decimals.
    sheet.L2 = { t: "n", v: 14995, z: "#,##0.00" };
    sheet.N2 = { t: "n", v: 165.9, z: "#,##0.00" };
    const data = write(workbook, { type: "array", bookType: format === "xls" ? "biff8" : "xlsx" }) as ArrayBuffer;
    const csv = spreadsheetToCsv(data);
    const result = readTransfer(csv, "products", "pesos");
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows[0]?.price_cents, "1499500");
    assert.equal(result.rows[0]?.cost_cents, "16590");
    assert.equal(result.rows[0]?.compare_at_price_cents, "");
    assert.equal(result.rows[0]?.product_status, "active");
    assert.equal(result.rows[0]?.variant_status, "active");
    assert.equal(result.rows[0]?.featured, "true");
    assert.equal(result.rows[0]?.new_arrival, "false");
    assert.equal(result.rows[0]?.sku, "00123");
    const cents = readTransfer(csv, "products");
    assert.ok(cents.errors.some((error) => error.includes("select Pesos")));
  });
}

test("CSV uses the same explicit price units and unchanged exports stay in centavos", () => {
  const csv = makeCsv([productColumns, row]);
  assert.equal(readTransfer(csv, "products", "pesos").rows[0]?.price_cents, "1499500");
  const exported = [...row];
  exported[11] = "1499500"; exported[13] = "16590";
  const unchanged = readTransfer(makeCsv([productColumns, exported]), "products");
  assert.deepEqual(unchanged.errors, []);
  assert.equal(unchanged.rows[0]?.price_cents, "1499500");
  assert.equal(unchanged.rows[0]?.cost_cents, "16590");
});

test("money normalization never rounds or guesses units", () => {
  assert.equal(normalizePrice("14,995.00", "centavos"), "14995");
  assert.equal(normalizePrice("165.90", "pesos"), "16590");
  assert.equal(normalizePrice("0.29", "pesos"), "29");
  assert.equal(normalizePrice("165.9", "pesos"), "16590");
  assert.equal(normalizePrice("", "pesos"), "");
  for (const invalid of ["-1", "NaN", "1e3", "1,23.00", "1.001", "9999999999999999"]) {
    assert.throws(() => normalizePrice(invalid, "pesos"));
  }
  assert.throws(() => normalizePrice("165.90", "centavos"), /Fractional centavos/);
});
