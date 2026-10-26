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

### Foundation upgrade (`0006_inventory_integrity`)

The existing catalog models are reused without duplicate products, variants, attributes or images. Money remains integer minor units (centavos for PHP); quantities remain whole PostgreSQL integers. Balances are the current stock authority, reservations track individual claims, and immutable movements audit each atomic change. Never independently sum reservations into a second stored balance or persist `available`: it is always `on_hand - reserved`. Use the atomic writer rather than direct table mutations.

Migration 0006 adds reservation-to-movement ownership FKs, movement-type arithmetic checks, nonblank reservation references, lookup indexes and reversal references. Existing history is checked during migration; invalid rows cause failure and must be investigated, not silently rewritten. Referenced variants, products, locations, reservations, actors and original movements cannot be deleted.

Each movement affects one existing location. `source_location_id` and `destination_location_id` are stored generated columns derived from its physical on-hand delta: an outbound entry has a source, an inbound entry a destination, and reservation-only entries neither. They cannot be supplied or changed by a caller, and restrictive FKs enforce valid locations. A two-location transfer is **not** a single movement; a future transfer workflow must atomically pair its outbound and inbound legs. No transfer API or UI is introduced here.

`reversal_of_id` links an exact full compensating movement on the same variant/location. A unique partial index permits only one reversal per original. A trigger checks opposite on-hand/reserved deltas, equal quantity, and the same reservation. Missing originals, self-references, reversal chains and mismatched references fail. There is no partial reversal allocation model in this phase.

The existing nine-argument `inventory_apply` interface delegates to a ten-argument overload with a null reversal reference. The overload accepts `p_reversal` as the last UUID argument and writes the reference together with stock/history; retry identity includes that reference. Only inverses representable by the existing movement types are supported (for example receipt → `ADJUSTMENT_OUT`, or reservation → `RESERVATION_RELEASE`). A reserved sale cannot be reversed into a single current movement type. A future return/order workflow must define that behavior explicitly. The application service/UI does not yet expose reversal requests.

### Migration history and generation baseline

Apply the complete journal in order: `0000_catalog_foundation` → `0001_catalog_integrity` → `0002_staff_auth` → `0003_admin_audit` → `0004_rate_limit_milliseconds` → `0005_inventory` → `0006_inventory_integrity`. Catalog tables must precede inventory FKs; auth must precede movement actors. Migration 0006 creates composite unique targets before dependent FKs. Migrations 0000–0005 are unchanged.

Before this upgrade, the journal extended through 0005 but generated snapshots stopped at 0001. `meta/0005_snapshot.json` reconstructs the pre-change **Drizzle model** baseline, linked to snapshot 0001, without adding or replaying SQL. Its tables, columns, enums and FK ownership are checked against an isolated database migrated through 0005. Handwritten SQL's automatically named constraints can differ from Drizzle's generated names; this baseline is not an introspection of a live database. The generated 0006 snapshot represents the new model and a regression test requires subsequent generation to produce no SQL. Custom SQL-only auth checks, functions and triggers remain authoritative in the SQL migrations and must be retained manually. `db:check` alone does not verify those objects.

For databases with partially installed inventory or manually applied auth SQL, do not run 0006 alone, replay old migrations blindly, mark unapplied journal entries complete, or use broad `IF NOT EXISTS` to conceal drift. Inspect actual tables, constraints, functions and migration bookkeeping before selecting a targeted reconciliation.

The one-time operator script `scripts/sql/reconcile-manual-migration-history-neon.sql` is pinned to the fully installed 0000–0006 baseline at commit `298de70`. It is outside the migration journal and never runs during builds, page requests or normal migrations. It verifies 18 tables, columns/defaults/generated expressions, constraints, indexes, enums, function bodies and enabled triggers against the tested baseline, plus the original stockroom ID. Only after all checks pass does it create the absent Drizzle ledger and insert the seven SQL SHA-256 hashes and journal timestamps. It does not replay application DDL or change business data. The operator must select the intended Neon **production** branch and **neondb** database; the script verifies the database name but cannot identify the Neon branch. Share locks briefly block application writes; lock acquisition times out after 10 seconds. Use the SQL Editor's plain **Run** button for the complete file. On failure, use **ROLLBACK** and inspect the failing check rather than bypassing it. Metadata differences across PostgreSQL versions may cause a safe rejection and need review.

The user reported a successful production reconciliation on October 26, 2026; that report is not an automated live audit. Do not rerun this script on an already tracked database: it rejects an existing ledger. Keep its historical baseline fixed when adding future migrations. `scripts/migration-history.test.ts` validates both manual-install and partial-recovery paths in disposable PGlite databases, exact recorded migration hashes/timestamps, preservation of account/session/catalog data, compatibility with the normal migrator, and rejection of repeated execution, wrong database, schema drift or a missing stockroom.

`npm run db:test` now also validates fresh installation, an upgrade preserving existing stock/history, migration reruns, snapshot generation, generated endpoints, reversal rollback/idempotency, reservation ownership, precision and historical deletion restrictions in disposable PGlite databases. It does not establish live-schema equivalence or multi-connection concurrency guarantees.
