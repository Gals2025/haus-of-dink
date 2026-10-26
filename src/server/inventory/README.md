# Inventory

Inventory is held per existing catalog variant and location. `available = on_hand - reserved`; no product or variant quantity column is an alternative authority. Migration `0005_inventory.sql` creates balances, reservations, append-only movements, and the initial **Main stockroom** location. It does not seed products, infer opening stock, or change existing catalog/auth data.

## Admin workflow

Open **Admin → Inventory**. Search by product/SKU, choose a location, and filter all/low/out-of-stock. Zero-stock SKUs are included even before their first movement. Low stock includes zero and uses the per-balance reorder level (initially 5). This phase displays reorder levels; changing thresholds and managing locations have no admin forms yet.

Choose **Record movement** next to a SKU. Opening stock must be that SKU/location's first movement. Purchases, returns, positive/negative corrections, damage, loss and cancelled-sale restocks require a positive integer quantity and a reason. Quantities are deltas, never replacement balances. Reference should identify the source document. Movement history records the actor, time, reference, reason and before/after balances. Correct mistakes with compensating entries; history cannot be edited, deleted or truncated.

| Permission | staff | admin | super_admin |
| --- | --- | --- | --- |
| inventory:read | yes | yes | yes |
| inventory:write | no | yes | yes |
| inventory:reserve | no | yes | yes |
| inventory:sell | no | yes | yes |

Each route and service checks the current Better Auth session, database role and active status. Mutations recheck at the database boundary, after the existing management lock, and lock the current user/session rows. The actor comes from the session, never from request fields. Reads repeat the current access predicate. Errors exposed by the action are generic and do not serialize SQL/session details.

## Engine and future checkout integration

Use the server-only `inventory.change(input)` service; do not write balances directly. `StockChange` is strictly validated. Keep `requestId` stable across retries: identical requests return the original movement ID; reuse for a different operation fails. A transaction failure rolls back stock, reservation and movement together. The action keeps its request ID after an uncertain failure so a retry cannot duplicate a receipt.

- `RESERVATION`: increases reserved only, requires an order/cart reference, and creates a reservation whose ID equals the request ID.
- `SALE` with `reservationId`: consumes the specified reservation's remaining quantity and reduces both on-hand and reserved. Partial fulfillment is supported.
- `SALE` without a reservation: reduces only available stock; it cannot consume another order's reserved stock.
- `RESERVATION_RELEASE`: requires `reservationId`, decreases reserved only, and cannot release more than the reservation has left. Use it for cancellations before fulfillment.
- `CANCELLED_ORDER_RESTOCK`: adds physically returned units after a sale already reduced on-hand. It must not be used to cancel an unfulfilled reservation.

The engine is ready for internal checkout/POS calls. This phase does not add a sales UI, checkout integration, reservation expiration scheduler, product CRUD, automatic reservation release, or transfer workflow. Callers must provide stable business references and request IDs; order-level return limits belong to the future order service.

## Transaction model

The existing Neon HTTP driver cannot run interactive JavaScript transactions. The service uses its supported atomic `db.batch()` for the account-management lock followed by a single mutation statement. `inventory_apply` is an invoker-rights, VOLATILE PostgreSQL function: it takes transaction advisory locks for request ID and SKU/location, obtains a fresh snapshot after waiting, locks the balance/reservation, checks availability, then writes all changes atomically. Database checks enforce `0 <= reserved <= on_hand`. Product deletion is restricted once inventory references a SKU.

All admin writers use the same existing management lock first. This deliberately serializes inventory mutations with access changes and is conservative for throughput; revisit the locking strategy with real multi-connection benchmarks before high-volume POS use. DB credentials are a trusted administration boundary: do not expose them to browsers or bypass the service with ad hoc inventory writes.

## Validation and rollout

`npm run inventory:test` runs migrated PGlite fixtures without live credentials: policy denial, stale authorization, arithmetic, retry idempotency, reservations, wrong-SKU/over-release protection, location isolation, history, rollback, and catalog protection. PGlite serializes its transactions; the competing-request test is **not** a multi-connection Neon concurrency test. Live transport and browser interaction still need staging verification.

Run typecheck, lint, auth tests, DB tests, migration checks, inventory tests and build. Review migration 0005 and the current database migration baseline before applying it through the existing tracked migration process. Do not seed fixtures into production. No migration is applied by a page render or stock action.

Existing auth/audit migrations are handwritten and the older generated Drizzle snapshots predate them. Inspect future `db:generate` output for duplicated tables; `db:check` validates journal consistency, not equivalence between generated snapshots and every custom SQL object. SQL functions/triggers in this module must be preserved in custom migrations.
