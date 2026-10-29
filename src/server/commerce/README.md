# Store operations

The three remaining workspace roadmap cards now have working administration routes:

- `/admin/orders`: search and paginate orders, create multi-SKU orders for an active customer and stock location, view immutable order snapshots/history, record received payments/refunds, fulfill or cancel pending orders.
- `/admin/customers`: create/edit contacts and deactivate/reactivate customers. Historical orders retain the contact snapshot; customer records are not hard-deleted.
- `/admin/promotions`: create/edit/disable fixed PHP or percentage codes with Philippine local start/end times, a minimum merchandise subtotal, and a usage limit. One code per order; cancelled orders release usage. Existing orders keep their original discount.
- `/admin/reports`: date-filtered fulfilled sales, pending deposits, cancelled counts, product costs, merchandise gross profit and daily CSV export. Dates are order-creation dates in Asia/Manila, inclusive of the selected end day. Gross profit excludes shipping and is omitted if any fulfilled line lacks a cost snapshot.
- `/admin/settings`: store name, public contact details and the default shipping fee. The public footer reads only contact fields; existing orders retain their shipping snapshot. Currency remains PHP.

## Authorization and atomicity

Admins and super admins can manage orders, customers and promotions, and read sales reports/settings. Only super admins can write settings. Staff receive none of these new permissions. Every read rechecks the database session, expiry, role and active status in its statement. Every mutation runs the existing `managementLock` as the first statement in the same `db.batch()` transaction, then locks/rechecks the actor and calls `commerce_execute`.

Creation reserves each line through `inventory_apply`; fulfillment consumes that exact reservation, and cancellation releases it. All line movements, order changes, promotion counters and append-only audit entries commit together. Existing reservations can be sold/released even after a product is archived or variant deactivated; inactive catalog entries cannot receive new orders. Current server prices and costs are snapshotted, and inputs cannot override totals. Integer centavos are used throughout. A caller-provided request UUID is bound to the actor and complete normalized payload; identical retries return the original result and changed retries fail.

Orders start pending/unpaid. Record a received payment before fulfillment. To cancel a paid pending order, first record an actual external refund. Fulfilled/cancelled orders are closed and cannot be edited or transitioned again. Payment and refund reference changes are retained in append-only audit payloads. Refunded pending orders must be cancelled to release their stock. Payment/refund recording does not transfer money. This release implements the admin roadmap; payment-gateway settlement, tax invoicing and returns after fulfillment are separate integrations.

`commerce_audit` stores the validated mutation payload (including customer contact snapshots and payment references for traceability), actor, target and request ID. Treat this table as sensitive business data; do not expose it through public APIs. No session tokens, credentials or auth claims enter it. The order UI projects only action/date/actor from its history. Update/delete/truncate are rejected by database triggers.

## Deployment

Apply `src/server/db/migrations/0010_commerce.sql` once to the intended database **after 0000–0009**. For a correctly tracked database, use `npm run db:migrate` with its identified `DATABASE_URL`. If migrations were applied manually, follow the existing migration-history reconciliation procedure before resuming Drizzle migration commands. Do not mix a manual SQL execution and a migrator run without reconciling the ledger. No database migration runs during build or a page request.

After migration, sign in as super admin, save store settings, add customers, and ensure active PHP variants have received stock. Create a small test order, record a real test payment reference, and fulfill it to verify the stock ledger. Use a separate unpaid test order to verify cancellation/release.

## Validation

`npm run commerce:test` uses disposable PGlite databases, applies the entire migration chain, and covers input validation, role policy, idempotency/payload mismatch, price/contact snapshots, atomic rollback on insufficient stock, payment/refund/fulfillment/cancellation transitions, promotion usage/expiry, archived-SKU reservation cleanup, fulfilled-only reporting, append-only audit and stale-session revalidation. No live database is used. Existing auth, database, migration, inventory and catalog suites remain required alongside typecheck, lint and build. On constrained machines run Node tests with `--test-concurrency=1` to avoid multiple PostgreSQL WASM instances exhausting memory.


## Guest checkout

Public `/shop` and `/checkout` accept orders without customer accounts. Contact records are separate from authentication users. Existing customer profiles are never overwritten using unverified guest details; each order snapshots the submitted contact. Guest orders and their reservations have a null actor, shown as Guest checkout in history. Admin routes and mutations retain existing permissions.

Checkout supports optional email, delivery or pickup, proof of payment for delivery and online-paid pickup, and admin confirmation. Pickup paid on collection is held for 24 hours. The order UUID is the guest tracking reference; tracking exposes only basic status and is rate limited. Payment proofs must use a dedicated private Blob store configured with `PAYMENT_PROOF_BLOB_READ_WRITE_TOKEN`. Vercel's scheduled function calls `/api/cron/expire-pickup-orders` every five minutes and requires `CRON_SECRET`.

Apply tracked migrations to the identified deployment database before enabling checkout. No migrations run during builds or requests. Guest orders reuse atomic server pricing, promotions, stock reservations and admin fulfillment. One server-selected location must supply the entire order. Submissions accept at most 30 distinct SKUs and 10 units per SKU. Network retries reuse the form request ID; a changed payload needs a new ID. The public tracker accepts an order UUID reference only, returns basic progress, and is rate limited.

Checkout supports optional email, pickup/delivery, payment proof and admin confirmation. Enter customer-facing GCash/bank instructions under Admin → Store settings. Configure a dedicated private Blob token as `PAYMENT_PROOF_BLOB_READ_WRITE_TOKEN`. Pay-on-pickup stock holds expire after 24 hours; Vercel Cron calls the expiry endpoint every five minutes and requires `CRON_SECRET`. Apply `0013_checkout_fulfillment_tracking.sql` and `0014_store_payment_instructions.sql` in journal order before deploying this checkout.
