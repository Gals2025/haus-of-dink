import assert from "node:assert/strict";
import { test } from "node:test";
import { read, utils, write } from "@e965/xlsx";
import { makeSpreadsheet, spreadsheetToCsv } from "../src/lib/data-transfer/spreadsheet";
import { parseCsv, productColumns, inventoryColumns } from "../src/server/data-transfer/csv";
import { GET } from "../src/app/api/admin/data-transfer/route";

for (const format of ["xls", "xlsx"] as const) {
  test(`${format}: round trip preserves identifiers, Unicode, quotes and formula-like text`, () => {
    const rows = [inventoryColumns, ["00123", "main", "12", '=SUM(1,2) "理由"\nstock', "@reference"]];
    const bytes = makeSpreadsheet(rows, format);
    assert.deepEqual(parseCsv(spreadsheetToCsv(new Uint8Array(bytes).buffer)), rows);
    const workbook = read(bytes, { type: "array" });
    const cell = workbook.Sheets.Data?.D2;
    assert.equal(cell?.t, "s");
    assert.equal(cell?.f, undefined);
  });

  test(`${format}: templates have the right filename, content type and columns`, async () => {
    for (const kind of ["products", "inventory"] as const) {
      const response = await GET(new Request(`http://localhost/api/admin/data-transfer?kind=${kind}&template=1&format=${format}`));
      assert.equal(response.status, 200);
      assert.ok(response.headers.get("Content-Disposition")?.endsWith(`hod-${kind}-template.${format}`));
      assert.ok(response.headers.get("Content-Type")?.includes(format === "xls" ? "ms-excel" : "spreadsheetml"));
      assert.deepEqual(parseCsv(spreadsheetToCsv(await response.arrayBuffer())), [kind === "products" ? productColumns : inventoryColumns]);
    }
  });
}

test("CSV templates remain compatible and unsupported formats are rejected", async () => {
  const response = await GET(new Request("http://localhost/api/admin/data-transfer?kind=products&template=1"));
  assert.equal(response.status, 200);
  assert.deepEqual(parseCsv(await response.text()), [productColumns]);
  assert.equal((await GET(new Request("http://localhost/api/admin/data-transfer?kind=products&format=exe"))).status, 400);
});

test("Excel imports reject oversized files, too many rows and extra columns", () => {
  assert.throws(() => spreadsheetToCsv(new ArrayBuffer(500_001)), /500 KB/);
  const rows = [inventoryColumns, ...Array.from({ length: 101 }, () => ["SKU", "main", "1", "restock", ""])];
  assert.throws(() => spreadsheetToCsv(new Uint8Array(makeSpreadsheet(rows, "xlsx")).buffer), /100 rows/);
  assert.throws(() => spreadsheetToCsv(new Uint8Array(makeSpreadsheet([Array(17).fill("extra")], "xls")).buffer), /extra columns/);
});

test("Excel imports use the first worksheet and preserve numeric display formats", () => {
  const workbook = utils.book_new();
  const first = utils.aoa_to_sheet([inventoryColumns, [123, "main", 12, "restock", ""]]);
  first.A2!.z = "00000";
  utils.book_append_sheet(workbook, first, "First");
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([["ignored"]]), "Second");
  const bytes = write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  assert.deepEqual(parseCsv(spreadsheetToCsv(bytes))[1], ["00123", "main", "12", "restock", ""]);
});
