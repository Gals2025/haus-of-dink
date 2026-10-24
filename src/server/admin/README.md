# Phase 3 — admin management

## Audit and reuse

Phase 2 at `49cdbbc` was inspected before changes and its 22 isolated tests passed.
`authorize.ts` validates Better Auth, a matching live database session, current database
role and active status. All three protected consumers (layout, dashboard, own-session
API) already use explicit permissions. The authentication catch-all only manages Better
Auth's own session lifecycle; signup and client-supplied role/active fields are disabled.
The initial internal-API tests found no critical omission. Later HTTP-handler validation
uncovered the Phase 2 blocker recorded below; this Phase 3 implementation is an unfinished draft.

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

## Delivery status — blocked (2026-10-25, Asia/Manila)

STOPPED under the task's Phase 2/security blocker rule. The full HTTP-handler regression
exposes an existing Better Auth rate-limit schema mismatch: `rateLimit.lastRequest` in
`src/server/db/schema/auth.ts:55` and migration 0002 is a timestamptz, but installed Better
Auth's database rate limiter passes `Date.now()` (numeric milliseconds). Drizzle's
PgTimestamp mapper throws `TypeError: value.toISOString is not a function` before the
sign-in handler executes. Neither that schema nor the existing auth options was changed
by Phase 3. Baseline tests used `auth.api` and did not exercise HTTP rate limiting.

Latest sequential validation: typecheck PASS, lint PASS, auth:test FAIL (33 passes;
one failing HTTP subtest plus its parent = 2 reported failures). db:test, db:check and
build were NOT RUN after the failure, as work stopped on the newly discovered critical
Phase 2 blocker. The draft's isolated mutation, listing, privilege restrictions, rollback,
audit immutability and competing stale-request tests passed. Inactive HTTP sign-in
validation cannot be completed until the rate-limit failure is repaired.

Next: repair Phase 2's rate-limit column/adapter compatibility with a separately reviewed
pending migration, add real HTTP sign-in and rate-limit regression tests, then restart
the entire required validation sequence and complete Phase 3 verification. Do not use
this draft or apply its migration as a release-ready change. No commits, pushes, PRs,
deployments, external database migrations or production-record changes were performed.
