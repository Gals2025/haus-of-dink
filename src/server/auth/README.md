# Authorization boundary — Phase 2

All protected server operations use `authorize.ts`. Better Auth establishes identity;
permission decisions use the current database user and a matching, unexpired database
session (ID, token, user ID). No request identity or permission result is memoized.
Unknown roles and permissions deny by default. Database errors propagate without access.

## Audited operations and permissions

| Operation | Permission | staff | admin | super_admin |
| --- | --- | --- | --- | --- |
| Admin protected layout | `admin:access` | Yes | Yes | Yes |
| Admin dashboard page | `dashboard:read` | Yes | Yes | Yes |
| GET /api/admin/session (own role only) | `session:read` | Yes | Yes | Yes |
| Compatibility `requireSuperAdmin()` boundary (no current consumer) | `super_admin:access` | No | No | Yes |

There are no administrative data mutations, user management endpoints, or server actions
yet. Roadmap cards do not grant access to future modules. Existing staff/admin dashboard
access is intended; granting user-management powers based only on dashboard access would
be accidental over-permission. Phase 3 must introduce explicit mutation permissions and
resource/target restrictions before exposing those operations.

`requireStaff()` retains the admin-entry check; `requireSuperAdmin()` retains its
super-admin-only behavior. Page helpers redirect unauthenticated/inactive callers to
`/admin/login` and authenticated callers missing a permission to `/admin`.
API handlers use `getPermissionSession()` and return a generic 401 without leaking identity.
Do not use page redirects for API mutations; those must return an appropriate HTTP error.
`hasPermission()` is a policy predicate, not proof of a current authenticated request.
Layouts and hidden controls never replace a check in each page, action, or handler.

## Better Auth lifecycle review

`options.ts` shares production session settings with isolated integration tests: 8-hour
expiry, 30-minute update interval, cookie session cache explicitly disabled. The protected
boundary also passes `disableCookieCache: true`, then rechecks session existence/expiry
and current role/active status together in a joined query. There is no secondary session
store configured. Revocation means deleting the persisted Better Auth session. Existing
cookies or previously returned identity objects cannot bypass this query.

Better Auth retains its own sign-in, session renewal, logout and own-session revocation
endpoints in `/api/auth/[...all]`; these are authentication lifecycle operations, not staff
permission grants. Sign-up is disabled; role/active fields cannot be supplied by clients.
Logout remains accessible for inactive accounts. No parallel authentication system or
custom token handling is introduced. The one-time bootstrap CLI is an offline provisioning
operation, not an HTTP endpoint; it is not executed by tests or this change.

Isolated tests exercise real Better Auth sign-in/session lookup, expiry, renewal and logout
against in-memory PGlite using the shared configuration, plus every permission, all roles,
inactive accounts, stale roles/identities, revocation, unknown permissions, and DB failures.
No test loads production environment files or connects to Neon. Migration SQL is executed
only inside disposable PGlite instances to validate compatibility; no external migration
is applied. No schema change or migration is required for this phase.

Each request observes current state at its authorization query. Future sensitive writes
must also guard against concurrent role/account changes at mutation time. The Neon HTTP
driver lacks interactive transactions; Phase 3 must address atomic final-super-admin and
audit-write invariants before implementing management mutations.
