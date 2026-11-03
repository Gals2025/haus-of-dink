import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { catalogFixture } from "./catalog-fixture";
import { transferExportQuery } from "../src/server/data-transfer/queries";
import { productColumns, inventoryColumns, parseCsv } from "../src/server/data-transfer/csv";
import { makeSpreadsheet, spreadsheetToCsv } from "../src/lib/data-transfer/spreadsheet";

test("product and inventory exports query real tables and enforce current sessions", async () => {
  const fixture = await catalogFixture();
  try {
    const identity = await fixture.signIn("admin");
    for (const kind of ["products", "inventory"] as const) {
      const columns = kind === "products" ? productColumns : inventoryColumns;
      const result = await fixture.db.execute(transferExportQuery(kind, identity));
      assert.ok(result.rows.length > 0, `${kind} should export seeded data`);
      const rows = result.rows.map((row) => columns.map((column) => String(row[column] ?? "")));
      for (const format of ["xls", "xlsx"] as const) {
        const bytes = new Uint8Array(makeSpreadsheet([columns, ...rows], format));
        assert.deepEqual(parseCsv(spreadsheetToCsv(bytes.buffer)), [columns, ...rows]);
      }
    }
    // A session valid at the first auth check may be revoked before the query.
    await fixture.db.delete(fixture.schema.session).where(eq(fixture.schema.session.id, identity.session.id));
    for (const kind of ["products", "inventory"] as const) {
      const result = await fixture.db.execute(transferExportQuery(kind, identity));
      assert.equal(result.rows.length, 0, "revoked sessions must not export data");
    }
  } finally { await fixture.client.close(); }
});
