# Phase 3 — admin management

## Audit and reuse

Phase 2 at `49cdbbc` was inspected before changes and its 22 isolated tests passed.
`authorize.ts` validates Better Auth, a matching live database session, current database
role and active status. All three protected consumers (layout, dashboard, own-session
API) already use explicit permissions. The authentication catch-all only manages Better
Auth's own session lifecycle; signup and client-supplied role/active fields are disabled.
The initial internal-API tests found no critical omission. Later HTTP-handler validation
uncovered a Phase 2 rate-limit schema mismatch. The local fix and validation are recorded
below; external migration application and integration verification remain pending.

Before Phase 3 there was no user-management implementation or audit store. Reused:
Better Auth, the centralized permission framework, lazy Neon/Drizzle access, PGlite
migration tests, protected admin layout, Brand, Badge, Button, cream/green brand tokens,
and Bodoni headings. No new authentication system or client identity claims were added.

## Protected operations

| Permission / operation | staff | admin | super_admin |
| --- | --- | --- | --- |
| `admin:access`, `dashboard:read`, own `session:read` | Yes | Yes | Yes |
| `users:read`: listing, search and filters | No | Yes | Yes |
| `users:status`: activation/deactivation | No | Staff targets only | Other accounts |
| `users:role`: assign staff/admin/super_admin | No | No | Other accounts |
| `users:privileged`: manage admin/super_admin targets | No | No | Yes |
| `audit:read`: recent administrative audit history | No | No | Yes |
| `super_admin:access`: compatibility boundary | No | No | Yes |

Self role/status changes always deny. A final active super admin cannot be demoted or
deactivated. Existing staff dashboard access is preserved; it grants no management powers.
Management views expose only ID, name, email, role and status; audit contains IDs and
before/after access state, never passwords, account tokens or session tokens.

## Entry points and validation

`/admin/users` authorizes its page and service independently. The `changeUser` Server
Action is a POST with Next.js's built-in origin/host protection; it accepts only a strict
Zod discriminated union, never an actor ID. Every action calls the service, which resolves
the current permission session. Role enums, booleans and expected target state are
validated server-side. Sensitive changes require a native modal confirmation with focus
handling, pending state, errors and refresh on success. Server enforcement does not rely
on client controls. `/admin/audit` checks `audit:read` independently at page and data layers.
Search is bounded and escapes LIKE wildcards; pagination is 25 rows with a deterministic
ID tie-breaker. All query values are bound parameters. Listing repeats live authorization
in the data query; results are not cached across requests.

## Transaction and concurrency design

Production uses **one Neon HTTP `db.batch()` transaction** containing two statements:

1. Acquire `pg_advisory_xact_lock(1948401, 3)`.
2. In a fresh READ COMMITTED snapshot, lock/revalidate the actor's database session and
   user, lock the target, enforce current operation permissions derived from
   `authorize.ts`, target restrictions, expected role/status, self-protection and final
   active-super-admin count. Update access, delete all target sessions and insert audit
   history via data-modifying CTEs.

The separate first statement matters: putting a waiting advisory lock inside a single
CTE statement would retain a stale snapshot. All management writers must keep this lock
protocol and the default READ COMMITTED isolation. The actor/target row locks also order
concurrent logout and session creation. `clock_timestamp()` validates session expiry
AFTER waiting, rather than using the transaction's start time. Failed audit insertion
rolls back the account mutation and session deletion. Stale confirmations and no-op
changes return a generic denial and do not add a misleading successful audit event.
Role changes also revoke sessions as a precaution. Failures do not serialize SQL errors
or credentials to clients. Audit history is append-only via update/delete/truncate
triggers; database owners can still bypass triggers and need separate operational controls.

The new session-insert trigger holds a shared user-row lock and requires active status.
This prevents a sign-in from creating a session after deactivation's revocation query,
or stockpiling inactive sessions that become useful after reactivation. Better Auth
continues issuing, renewing and deleting its own sessions.

## Migration requirements

`0003_admin_audit.sql` and its journal entry are **pending**. It adds the audit table,
indexes, audit immutability triggers and active-session-insert trigger. The migration
must be reviewed and applied separately to a non-production database before testing
these screens with real accounts. No external migrations, seeding, provisioning or user
updates are performed by this task. Test migrations run only in disposable PGlite.

The preceding manually maintained auth migration has no Drizzle snapshot. This change
follows its SQL/journal convention; do not blindly run `db:generate` and accept a diff
that recreates auth/audit tables. Reconcile migration snapshots before later generated
schema work. `db:check` checks journal consistency; it is not proof of live schema parity.

## Validation boundaries

Tests share production SQL and run it in PGlite transactions. They cover allowed/denied
roles, listing/search/pagination and minimal fields, role and status changes, full session
revocation, stale target/actor state, expiry and revocation, self/final-admin safeguards,
audit correctness, append-only history, rollback on audit failure and inactive sign-in.
The competing requests test uses PGlite's serialized transaction queue. It does **not**
prove independent-connection PostgreSQL lock scheduling or Neon HTTP transport behavior.
Before deployment, exercise two independent connections in an isolated Neon branch,
including sign-in versus deactivation and cross-super-admin mutations, and verify the
responsive UI and confirmation flows in a browser. No live account data is needed.

Direct database writers and future bulk/provisioning/deletion paths must preserve these
invariants; database owners are outside application authorization. Audit reads show the
latest 50 entries; pagination/export, retention policy, account invitations and password
recovery are separate follow-up features. Failed attempts are not stored as successful
administrative audit changes; external security telemetry can record them separately.

## Rate-limit blocker resolved locally (2026-10-25, Asia/Manila)

The initial full HTTP-handler regression exposed a pre-existing schema mismatch:
`rateLimit.lastRequest` was timestamptz, but Better Auth's database limiter passes
numeric Unix milliseconds from `Date.now()`. Drizzle's timestamp mapper threw
`TypeError: value.toISOString is not a function` before sign-in. Internal `auth.api`
tests bypass HTTP middleware and therefore missed this failure.

The schema now maps `last_request` to `bigint` with Drizzle's `mode: "number"`.
Pending migration `0004_rate_limit_milliseconds.sql` preserves bucket IDs, keys and
counts, converting existing timestamps with `floor(extract(epoch ...) * 1000)`.
Previous migration SQL was not rewritten. The application fix requires that pending
migration before use against an existing database. Deploy schema and code together
under a separately reviewed rollout; conversion changes the column type and takes a
table lock. Never run older timestamp-based application code against the new column.

`auth-http.test.ts` exercises the real HTTP handler with shared production options:
valid sign-in and usable cookie, numeric persistence, invalid credentials, HTTP 429
and retry header after the sign-in limit, window reset, concurrent requests, and logout.
A legacy-schema upgrade test preserves an existing millisecond-precision timestamp
and bucket count and verifies a migration rerun is harmless. All tests use disposable
PGlite; no environment files or external database connections are loaded by the tests.

The complete required sequence passed in order:

- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run auth:test`: PASS (42 tests)
- `npm run db:test`: PASS (14 tests)
- `npm run db:check`: PASS
- `npm run build`: PASS (including `/admin/users` and `/admin/audit`)

The inactive-account HTTP negative test receives a generic failure without SQL or
session parameters in its response. Better Auth emits a server-side adapter diagnostic
for the expected database-trigger rejection; production log redaction/handling should
be reviewed before release. Independent-connection Neon lock behavior and browser UI
flows still need the separate isolated integration checks described above.

The prior Phase 3 draft was pushed as `ec2bd9c`. This follow-up contains the validated
rate-limit fix for staging. No external migrations or live-record changes were performed.
Migrations 0003 and 0004 remain pending externally; deployment and integration checks
are separate from committing and pushing this code.

## People & access CRUD (2026-10-27)

`/admin/users` now includes Add team member, Edit profile and confirmed Delete,
using the existing list, filters, pagination, role and activation controls.
`users:create`, `users:update` and `users:delete` are granted only to super admins.
Admins retain read access and staff activation/deactivation. Staff cannot manage users.
All operations resolve the actor on the server and recheck the current permission,
session and account after the shared management lock. Profile and delete requests
also compare the displayed name/email/role/status to reject stale confirmations.
Your own account is protected. Deletion retains the last-active-super-admin check.

Creation normalizes email, rejects case-insensitive duplicates and hashes a 12–128
character initial password with Better Auth's password hasher. User, credential
and audit insertions commit atomically. Profiles support name/email updates;
changing email clears email verification. Profile edits revoke existing sessions.
Deletion removes credentials and sessions through the existing foreign keys;
audit history survives. Accounts referenced by inventory movements cannot be
deleted: deactivate them instead to preserve the inventory ledger. No bulk user
imports, invitations, public sign-up or password-reset behavior is added.
The existing reset flow depends on its separately configured email delivery.

Apply `0008_people_crud.sql` using the normal reviewed migration process, after
identifying the intended database and verifying its migration history. It extends
`admin_audit_action_check` to allow `create`, `profile`, `delete`, preserving all
existing audit events and append-only triggers. It changes no live users. Without
this migration, the new lifecycle operations roll back when their audit inserts
are rejected. No migrations run from builds or page requests.

CRUD tests use disposable PGlite and real Better Auth credential sign-in. They cover
role restrictions (including forged stale authorization), input validation, email
normalization/duplicates, hashed credential compatibility, stale profile edits,
self-protection, session revocation, deletion cascades, retained audit history,
inventory-history deletion rejection and full rollback when audit insertion fails.
Profile audit events record actor/target and access state, not prior name/email.
Independent Neon connection concurrency and authenticated browser flows remain
integration checks; isolated tests do not prove production transport behavior.
