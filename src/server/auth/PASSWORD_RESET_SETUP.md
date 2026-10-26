# Staff password reset setup

The code uses Better Auth's `/request-password-reset` and `/reset-password`
endpoints with Resend delivery. Signup remains disabled. Resetting a password
never changes a role or active status. No new migration is required: Better Auth
uses the existing verification table.

## Configure production

1. In Resend, add a domain you own, publish the DNS records Resend supplies,
   and wait until the domain is verified. Disable click/open tracking for the
   transactional sending domain. Create a sending API key restricted to that
   domain where available. Do not use a Gmail address as the sender.
2. In the Vercel Haus of Dink project's environment settings, select **Production**
   for the production branch **main**. Add server-only variables:

   | Variable | Value |
   | --- | --- |
   | `RESEND_API_KEY` | The sending key created in Resend |
   | `AUTH_EMAIL_FROM` | A plain email address on the verified domain |
   | `DATABASE_URL` | The existing production Neon connection string |
   | `BETTER_AUTH_SECRET` | The existing production secret; do not rotate it for a reset |
   | `BETTER_AUTH_URL` | https://haus-of-dink.vercel.app (or the configured production origin) |

   Keep credentials out of chat, screenshots and Git. Apply changes to the Production environment. Environment changes apply to a
   new deployment only.
3. In the **production** Neon SQL editor, confirm the database/branch first, then run
   this read-only query:

   ```sql
   SELECT email, role, active
   FROM "user"
   WHERE lower(email) = lower('justinaylmergalindo@gmail.com');
   ```

   Stop if there is no matching account. An inactive account remains blocked
   after a reset. Resolve account provisioning/access separately; do not use the
   bootstrap command or promote a role as part of password recovery.
4. The owner selected `main` as the working and production branch. Deploy this
   code from `main`; adding variables alone does not install the UI.
5. After the production deployment, open `/admin/forgot-password`, enter
   `justinaylmergalindo@gmail.com`, and check inbox/spam. A successful request is
   intentionally generic and does not prove that an account exists or that the
   inbox received the message. Check Resend's Emails dashboard for acceptance,
   delivery, or bounce. Never copy reset links into application logs or chat.
6. Follow the email link, choose and confirm a new password (12–128 characters),
   and sign in. The reset token is consumed, all prior sessions are revoked,
   and the original role/active status is preserved.

For local verification, use `.env.local` with the same server-only settings and
an explicitly confirmed isolated development database. Set `BETTER_AUTH_URL` to the local
origin (normally `http://localhost:3000`) for locally generated links. Do not
commit `.env.local`. The isolated tests do not load credentials, access Neon,
contact Resend or send real emails.

## Security and operational behavior

- Tokens expire after 15 minutes, are hashed in the verification table, and are
  consumed by Better Auth. Concurrent reuse permits only one successful reset.
- The email links directly to `/admin/reset-password#token=...`. URL fragments
  are not sent in web requests. The browser reads the token into memory and
  removes the fragment from its current history entry. Reloading the page after
  that removal requires reopening the email link. No browser storage is used.
- Admin pages send `Referrer-Policy: no-referrer` and prohibit search indexing.
  The POST sends the token in its JSON body. Do not enable request-body logging
  for auth endpoints or add third-party analytics to the recovery page.
- Better Auth logging is disabled to prevent SQL parameters in adapter errors
  from exposing credentials or tokens. The route boundary also sanitizes thrown
  errors; the sender never propagates raw network/provider errors.
- HTTP reset endpoints retain database-backed Better Auth throttling. Unknown
  email addresses get the same successful response as known addresses.
- The sender awaits Resend acceptance and requires a receipt ID. Better Auth
  deliberately absorbs delivery exceptions and retains the generic HTTP success
  response to avoid disclosing account existence. Delivery failures emit only a
  fixed diagnostic (no user, token or provider payload). Check Resend delivery
  status rather than inferring delivery from HTTP 200. Missing email settings
  disable delivery without preventing ordinary staff sign-in.
- The existing Neon HTTP adapter does not support interactive transactions.
  Better Auth consumes the token, revokes sessions, then saves the password.
  If a database step fails after consumption, request a fresh reset link. Do not
  enable adapter transactions without changing to a supported database driver.
- No reset email has been sent or production account verified by the local tests.

References:
- https://better-auth.com/docs/reference/options
- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/docs/dashboard/domains/introduction
- https://vercel.com/docs/environment-variables
