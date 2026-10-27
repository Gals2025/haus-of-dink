# Staff catalog backend

`service.ts` exports these server-only functions. Inputs are `unknown` so callers
cannot bypass runtime validation. All results use `{ ok: true, ... }` or
`{ ok: false, code, error }`; errors contain no SQL, tokens or driver details.

- `listProducts(input?: unknown): Promise<ListResult>`
- `getProductDetail(id: unknown): Promise<DetailResult>`
- `listProductOptions()`: permission-protected brand/category option DTOs
- `createProduct(input: unknown): Promise<MutationResult>`
- `updateProduct(productId: unknown, input: unknown): Promise<MutationResult>`
- `archiveProduct(productId: unknown): Promise<MutationResult>`
- `reactivateProduct(productId: unknown): Promise<MutationResult>`

Staff pages and Server Actions are described in the Phase 3 section below.
Public HTTP mutation routes are not exposed. Server Action variant and catalog management workflows are documented below.

## Contracts and reads

The initial checkout contained catalog schema and fixtures but no Phase 1 validation
module or Phase 2A product service. Remote Phase 1 work discovered while publishing
is preserved in phase1-contracts.ts and foundation.ts, with compatible exports
from contracts.ts and its original validation tests in catalog-phase1.test.ts. `contracts.ts` defines contracts based on the
existing schema: UUID references, trimmed name (240), normalized slug (260),
nullable descriptions (short: 500; long: 20000), required brand/category,
boolean flags and draft/active/archived status. Create defaults to draft and
false flags. Unknown keys are rejected, including actor and role fields.
Only descriptions may be null. Undefined patch values are omitted.

Reads require inventory:read, resolve the current Better Auth session and
active database role, and recheck at the SQL boundary. Listing defaults to
20 records, supports sizes 1–100, returns total and totalPages (0 if empty),
and preserves counts beyond the last page. It supports status, brand,
category, featured/newArrival, escaped name/slug substring search and
newest/oldest/name ascending/name descending ordering with UUID tie breaks.
One SQL statement returns each count/page or detail snapshot. Detail includes
variant prices and image metadata; account and session fields are never returned.

## Writes, authorization and concurrency

Every operation requires inventory:write through current Better Auth/session
and database-backed role resolution. The SQL statement rechecks binding, token,
expiry, active user and permitted database role, locking actor/session rows.
No actor identity is accepted from input. Reference existence is enforced by
the existing brand/category foreign keys in the mutation statement; these
constraints prevent concurrent deletion from producing invalid references.
The existing `products_slug_unique` constraint is authoritative, including
colliding creates/updates. Constraint errors are translated to safe results.

The production Neon HTTP adapter uses db.batch for a READ COMMITTED transaction:
1. Take the same transaction advisory managementLock as administrative writers.
2. Execute the product mutation and audit statement on a fresh snapshot.

Never move the lock into the mutation CTE: its snapshot could precede a wait.
Cooperating catalog and administrative writers are serialized. Updates also lock
the target row, set only supplied fields, and compare actual stored values.
Disjoint patches are retained; writes to the same field use last serialized
writer wins. This is not optimistic version checking. The global lock favors
correctness over write throughput; revisit it only with multi-connection tests.

Empty updates, equal-value updates, repeated archive, and reactivate of any
non-archived product succeed with changed=false (missing IDs remain NOT_FOUND).
No-op requests do not change timestamps or create audit rows. Archive only sets
archived. Reactivate changes archived to draft; active and draft remain unchanged.
Explicit updateProduct status changes are allowed by the product contract.
Normal updates use the existing database timestamp trigger. No child records,
inventory balances, reservations or movements are written by these services.

## Audit and migration

0007_catalog_audit adds a dedicated append-only table, action check, index and
immutability triggers. Its generated snapshot and journal preserve ordering.
Existing migrations are unchanged. There is no cascade to accounts or products.
Actor, product, action, database timestamp, submitted field names and approved
before/after state are recorded. Descriptions use lengths instead of contents;
field names still identify an equal-length description change. No account,
credential or token details enter the audit DTO.

The data-modifying CTE writes product and required audit in the same statement
and transaction. An audit failure rolls back the product mutation; mutation
failure cannot generate a successful audit. No-op requests are not audited.

The migration must be reviewed and applied separately to an explicitly identified
target before runtime writes. No deployment migration is run by build, reads,
mutations, or the catalog test command. Missing schema is reported UNAVAILABLE.

## Verification boundaries

`npm run catalog:test` uses fresh, in-memory PGlite instances with synthetic
fixtures. Like the existing test suites, its fixture installs migrations into
that disposable instance only. It never reads DATABASE_URL or connects to Neon.
Contracts are pure validation tests. Read/mutation tests execute real PostgreSQL
SQL, unique/FK constraints, triggers and transactions; injected failing triggers
verify rollback and audit consistency. Overlapping Promise requests exercise
PGlite's serialized transaction adapter, not separate concurrent PostgreSQL
connections. Multi-connection Neon HTTP batch/locking behavior remains unverified
until a separately provisioned isolated database is available. Never substitute
a production connection for that test target.

## Phase 3 admin interface

- `/admin/products`: searchable/filterable list, deterministic sorting, 20-row
  pages and total counts; query-string filters survive pagination.
- `/admin/products/new`: permission-protected create form, default draft,
  automatic/editable slug, database-backed brand/category choices.
- `/admin/products/[productId]`: detail with editable variants and read-only images,
  success feedback, confirmed archive/reactivate operations.
- `/admin/products/[productId]/edit`: editable fields and explicit null clearing
  of descriptions; sends only changed fields to preserve other editors' work.

All pages require inventory:read; create/edit pages require inventory:write.
The navigation and write controls follow the current database-backed role.
Server Actions authorize independently of page rendering, then call the Phase
2B services, which recheck the session and role again at the SQL boundary.
Brand/category option reads also recheck inventory:read inside their query.
No raw identity, token, account or role data is passed to client components.

Pending states disable repeated submission, errors retain entered form values,
and successful writes refresh product and stock pages. Archive/reactivate use
an explicit confirmation step. Reactivation restores draft, without publication.
An archived product's edit form keeps status locked; use its detail action to
reactivate it. Product descriptions render as text. Client-side validation is
convenience only; services validate every submitted payload independently.
A cache-refresh failure after a confirmed write retains the successful result
to avoid inviting a duplicate create; the client also navigates/refreshes.

The existing inventory and user/access screens are unchanged. Products appears
as its own workspace module with the existing selected-navigation behavior.
Image uploads and storefront changes remain outside this UI. Catalog and variant
management extensions and their explicit migration are described below.

`catalog-admin.test.ts` covers query parsing and pagination preservation, partial
edit payloads, permission-gated actions, current option-read authorization, safe
errors and successful action→service→SQL operations in isolated PGlite. A
separate explicitly labeled unit test covers cache-refresh failure handling.
The browser flows still require signed-in verification in a configured
application; the local test runner does not substitute for that check.


## SKU setup and stock receipts

On a product detail page, inventory writers can add a SKU with a PHP selling
price, optional barcode, unit cost and compare-at price. Simple products need
one SKU; separate colors/sizes can have distinct SKUs. Attribute values can be selected in the SKU form; maintain available options
in Categories & brands. Archived products must be reactivated first.

SKU creation validates the existing variant contract, rechecks current access
under the management lock and inserts a catalog audit update atomically.
Duplicate SKUs (case insensitive) and barcodes are rejected. It does not change
stock. No additional migration is needed beyond the existing catalog audit.

Use Receive stock on the product page or inventory row to record a purchase.
Choose Opening stock for items already on hand. Both use the existing inventory
ledger and request identifiers; retrying a receipt cannot add stock twice.
The variant integration test creates a product, adds its SKU, confirms its zero
balance, receives a delivery, retries it, and checks authorization and rollback.

## Catalog and variant management

Apply `0009_catalog_management.sql` through the normal migration process to an
explicitly identified database before deploying these workflows. It adds the
append-only `catalog_management_audit` table and its immutability triggers;
there is no automatic migration during requests or builds.

- `/admin/catalog`: searchable brand, category, attribute and attribute-value
  lists. Writers can create/edit records and delete unused records after an
  explicit confirmation. Brand fields include description, HTTPS website and
  HTTPS logo URL. Categories support parent selection and recursive cycle
  prevention. Brands/categories can be active or inactive; new product
  assignments require active choices, while existing inactive references can
  be retained. Attribute values cannot move to another attribute.
- `/admin/catalog/history`: latest 100 catalog management changes, with before
  and after metadata. Descriptions are excluded from audit snapshots. History
  survives removal of unused catalog records.
- `/admin/variants`: searchable, status-filtered, paginated cross-product SKU
  list with prices, costs and option labels. Each row links to its product.
- Product detail: create/edit variants, assign one value per attribute, edit
  SKU/barcode/prices/cost/status, and explicitly delete unused SKUs. Selecting
  no values preserves support for simple or legacy SKUs. Nonempty attribute
  combinations must be unique within a product, including inactive variants.
  Variant changes and assignments are audited atomically in `catalog_audit`.

All reads recheck inventory:read and all writes recheck inventory:write at the
SQL boundary. Management mutations use the shared transaction management lock,
which serializes ancestry/reference/combinations checks with other application
writes. These checks do not protect arbitrary direct SQL writes outside the
application. Foreign keys remain authoritative for deletion restrictions.
Variant removal is blocked by any stock, reserved quantity, movement or
reservation history. Empty balance rows without history can be removed along
with an unused SKU. Deactivation preserves all stock and history; inactive SKUs
must be reactivated before recording further inventory movements.

`catalog-management.test.ts` verifies CRUD, category ancestry cycles, HTTPS
validation, current database authorization, attribute ownership and replacement,
duplicate combinations, paginated/escaped SKU search, inventory protection,
audit immutability and rollback in disposable PGlite. No live database is used.
Signed-in browser flows and independent Neon connection concurrency still need
verification against an explicitly configured non-production application.
