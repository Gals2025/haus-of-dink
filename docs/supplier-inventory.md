# Supplier purchasing and inventory

## Daily workflow

1. **Products → Create product:** enter product name, brand, category and selling price in PHP. Choose counted stock or availability-only, or use the store default. Save creates the product and its first selling SKU together. A thumbnail and multiple supplier purchase codes/default costs are optional. Supplier cost fields are PHP, not centavos. Physical options such as sizes or colors remain under Advanced in product details.
2. **Save and receive stock** opens a delivery with the new product selected. Alternatively, use **Inventory → Receive stock**. Choose one supplier, destination location and delivery date, then add all delivered products, quantities and actual unit costs. Create missing suppliers or products inline without losing the receipt.
3. Review the total and confirm. All lines save in one transaction. For counted products this increases on-hand stock. Availability-only purchases record the supplier and cost without changing quantities or the available/not-available switch.
4. **Inventory → Suppliers & costs** maintains supplier purchase codes/default costs. Receiving suggests the most recently posted cost from that supplier for the SKU, then the configured default. Changing supplier resets the suggested costs; confirm each actual cost against the invoice.
5. Inventory groups physical variants under each product. Existing products without any selling SKU appear under **Setup needed**; open the product and supply a selling price/SKU. No price is guessed.

Use one selling SKU for identical physical items purchased from different suppliers. Supplier purchase codes do not create duplicate storefront items. Supplier associations can be added before the first purchase or automatically when posting a receipt. Suppliers are required on purchased deliveries, optional when creating products.

## Corrections and costs

Posted receipts and valuation corrections are permanent. Retry an unchanged, uncertain receipt with the same request ID. After a confirmed receipt, start a new delivery for a new shipment. Inspect posted delivery history before retrying with changed data.

Correct quantity mistakes with **Inventory → Opening stock / correction**, choosing the correct movement and documenting the original receipt reference. Use **Suppliers & costs → Correct stock valuation** to correct the *total cost value of all remaining on-hand units at that location*, including reserved units. A valuation correction does not change quantity or rewrite the original receipt or historical sales. Incorrect costs that affected past sales need an accounting adjustment outside this feature; this system never silently rewrites saved sale costs.

Counted stock uses moving weighted average independently at each SKU/location. The ledger stores integer centavo total values. Outbound costs are allocated proportionally, rounded to a centavo; the last units consume the remaining total. Reserving stock does not change its value. POS takes cost immediately; online orders take cost at fulfillment. Inbound reversals with a known original movement use its recorded cost; other manual additions use the current average, or the SKU reference cost when opening empty stock. Unknown opening costs remain unknown, including after receiving known-cost stock, until an admin supplies a valuation.

Availability-only sales use an **estimated** cost from the most recently posted receipt for that SKU/location, falling back to the SKU's reference cost. Missing costs remain unknown. Reports use saved fulfilled line totals and label estimates/legacy references. Changes to product prices, supplier defaults, future receipts or valuations cannot reprice earlier sales.

## Imports and compatibility

Existing product and inventory CSV/XLS/XLSX import formats remain supported. The legacy inventory import sets physical target counts; it is a stock correction, not a purchase receipt.

The receiving page has a separate supplier receipt template with exactly these headers:

```csv
sku,quantity,unit_cost_php
SKU-00000001,3,165.90
```

Upload CSV, XLS or XLSX (first worksheet, up to 100 unique SKUs and 500 KB). Select supplier, location, delivery date and reference in the receipt screen. Import only fills the editable review; Confirm receipt uses the same validation and atomic posting operation as manual receipt entry. Costs in this template are always PHP amounts. Opening stock and subsequent purchased deliveries have distinct actions.

Purchase orders, accounts payable, supplier payments, foreign currency conversion, and automatic freight/tax allocation are outside this feature. Enter the actual PHP unit cost you want valued.

## Release / migration

Migration: `src/server/db/migrations/0019_supplier_receiving.sql`.

1. Identify the intended production database and configure its `DATABASE_URL` securely. Confirm backup/recovery access and apply during a quiet period: the migration backfills balances and fulfilled order line costs and adds costing triggers.
2. Run required local checks, including `npm run purchasing:test`, `npm run db:test`, `npm run inventory:test`, `npm run commerce:test`, `npm run db:check`, typecheck, lint and build.
3. Against the identified database, run `npm run db:migrate` once **before deploying this application version**. The migration is additive and preserves SKU IDs, barcodes, stock quantities, reservations, old movements and order prices. Existing nonempty balances use quantity × reference SKU cost where known; missing costs remain unknown. Existing fulfilled order lines use their saved legacy reference costs and remain labeled as estimates.
4. Deploy and smoke-test one product creation, one counted delivery, one availability-only delivery, a POS sale, and an online fulfillment. Check receipt history, stock totals, unknown valuation prompts and profit labels. Review unknown opening values before relying on profit reports.

Do not run migrations automatically during a build or page request. No production database migration is performed by the tests. If the application needs rolling back, retain the additive schema and purchasing history; do not drop receipt/value columns or tables. Older application versions do not display the new cost totals.
