import { read, utils, write } from "@e965/xlsx";

export type ExcelFormat = "xls" | "xlsx";

// Read only the first worksheet and one extra row to detect oversized imports.
// Formulas and macros are never evaluated.
export function spreadsheetToCsv(data: ArrayBuffer): string {
  if (data.byteLength > 500_000) throw new Error("Choose a file no larger than 500 KB.");
  const workbook = read(data, { type: "array", sheets: 0, sheetRows: 102, cellFormula: false });
  const name = workbook.SheetNames[0];
  const sheet = name ? workbook.Sheets[name] : undefined;
  if (!sheet) throw new Error("The workbook has no worksheet.");
  // Excel's used range includes cleared/formatted cells. Inspect actual values
  // rather than rejecting a valid template because that range extends right.
  let lastColumn = 0, lastRow = 0;
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith("!") || cell.v === undefined || cell.v === null || cell.v === "") continue;
    const position = utils.decode_cell(address);
    if (position.c >= 18) throw new Error("The worksheet has data in extra columns. Remove values outside the template columns.");
    lastColumn = Math.max(lastColumn, position.c);
    lastRow = Math.max(lastRow, position.r);
  }
  // Bound conversion to populated columns; optional empty fields still retain
  // their positions because all template headers are populated.
  sheet["!ref"] = utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastColumn } });
  const rows = utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "", blankrows: false });
  if (rows.length > 101) throw new Error("Upload up to 100 rows at a time.");
  return rows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(",")).join("\r\n");
}

export function makeSpreadsheet(rows: string[][], format: ExcelFormat): Uint8Array {
  const workbook = utils.book_new();
  // String cells preserve SKU/barcode leading zeros and cannot become formulas.
  utils.book_append_sheet(workbook, utils.aoa_to_sheet(rows), "Data");
  return new Uint8Array(write(workbook, { type: "array", bookType: format === "xls" ? "biff8" : "xlsx" }));
}
