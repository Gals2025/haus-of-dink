# Haus of Dink

Phase-two database foundation for a pickleball storefront and management portal, intended for Vercel.

## Scope

Implemented: Next.js App Router, strict TypeScript, Tailwind CSS, shadcn/ui, responsive storefront and admin layouts, and placeholder routes `/`, `/shop`, `/admin`.

Implemented in phase two: Neon HTTP access, Drizzle catalog schema, versioned migrations, and repeatable development seeds. Authentication, inventory, cart, checkout, orders, payments, and promotions are not implemented. `/admin` is a public preview containing no sensitive data or actions. It is not a secure admin portal yet.

## Local development

Use Node.js 24 (`nvm use`) and npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. All three placeholder routes still build and render without credentials. Database commands and runtime database access require `DATABASE_URL`.

```bash
npm run typecheck
npm run lint
npm run build
npm start
```

`typecheck` generates Next.js route types before running TypeScript. Lint treats warnings as failures. Run `npm run db:test` for isolated PostgreSQL migration, seed, relation, and constraint tests without Neon credentials. The existing routes remain static placeholders.

## Architecture

| Location                 | Responsibility                                                                   |
| ------------------------ | -------------------------------------------------------------------------------- |
| `src/app/layout.tsx`     | Root document, global styles and metadata                                        |
| `src/app/(storefront)/`  | Shared public layout, home and shop routes; the route group does not affect URLs |
| `src/app/admin/`         | Independent admin layout and overview placeholder                                |
| `src/components/layout/` | Shared brand and navigation                                                      |
| `src/components/ui/`     | Local shadcn/ui component source                                                 |
| `src/features/`          | Future feature modules, created incrementally                                    |
| `src/lib/utils.ts`       | UI class-name composition                                                        |
| `src/lib/validation/`    | Future shared Zod input schemas                                                  |
| `src/server/env.ts`      | Lazy, server-only environment parsing with sanitized errors                      |
| `src/server/db/`         | Centralized Neon HTTP access, Drizzle schema and migrations                        |
| `src/server/auth/`       | Reserved Better Auth and centralized authorization                               |
| `src/server/storage/`    | Reserved server-side Vercel Blob operations                                      |

Pages and layouts are Server Components by default. Add client components only for browser interaction; keep business rules outside UI. shadcn components are owned source, configured in `components.json`; Tailwind v4 theme tokens live in `src/app/globals.css`. The theme uses local system fonts so builds do not fetch remote fonts. The npm lockfile records the exact dependency tree.

Database access is lazy and server-only through `getDb()` in `src/server/db/index.ts`. Schema definitions live in `src/server/db/schema/`; reviewed SQL and snapshots live in `src/server/db/migrations/`. The HTTP driver avoids persistent socket pools in Vercel functions and supports atomic `db.batch()` operations. Interactive transactions are not supported by this driver; select an appropriate transaction driver when the inventory phase requires them. Auth and Blob integrations remain reserved. See [database architecture and setup](src/server/db/README.md).

## Environment variables

All variables below are server-only. `DATABASE_URL` is required for database operations; the other integrations remain optional. `.env.example` contains empty placeholders rather than credentials. Never add `NEXT_PUBLIC_` to these names, commit `.env.local`, or expose parsed server configuration to client components.

| Variable                | Purpose when its integration is implemented                               |
| ----------------------- | ------------------------------------------------------------------------- |
| `DATABASE_URL`          | Neon PostgreSQL URL with `sslmode=require`; use separate development, staging and production branches |
| `BETTER_AUTH_SECRET`    | Random authentication secret of at least 32 characters                    |
| `BETTER_AUTH_URL`       | Auth application's origin; local default `http://localhost:3000`          |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token for authorized product-image uploads                    |

`getServerEnv()` validates supplied values lazily; it does not assert that integrations are configured. Future integration modules must require their own credentials before use, failing closed. Import `server-only` in all runtime server modules.

## Database setup (phase two)

1. Create a Neon project and a **development branch/database**; choose a region near your Vercel region. Keep staging and production separate.
2. Copy the database connection string from Neon’s Connect dialog into `DATABASE_URL` in `.env.local`. Retain `sslmode=require`; use the pooled URL supplied by Neon (hostname includes `-pooler`). Do not paste credentials into tracked files or chat.
3. Run the commands below against the development database. Migrations require a role permitted to create tables, enums, indexes, functions and triggers. For production, use a separate migration role and a restricted runtime role.

```bash
npm run db:check
npm run db:migrate
npm run db:seed
```

The first migration creates the eight catalog tables; the second installs database-managed timestamps and category cycle checks. `db:migrate` tracks applied files in `drizzle.__drizzle_migrations`. Do not run migration SQL manually through the Neon editor; that bypasses migration tracking. For later schema changes, run `npm run db:generate -- --name=describe_change`, review and commit generated SQL/snapshots, then run `npm run db:migrate`. Custom triggers live in the custom migration and must be maintained through subsequent custom migrations.

The development seed inserts 5 brands, 6 categories, 7 illustrative products, 9 variants, 9 attributes, 13 attribute values and 15 assignments in one atomic batch. Stable fixture UUIDs make reruns non-destructive: existing fixtures are preserved. Unrelated slug/SKU collisions fail and roll back the batch. It refuses `NODE_ENV=production`; always verify the target is a development database. Sample prices and SKUs are illustrative. Images are intentionally not seeded with fabricated URLs: upload real product images to Vercel Blob in a later phase, then store their HTTPS URLs in `product_images`.

In Vercel, configure `DATABASE_URL` separately for Preview and Production. Point Preview to staging, and use a dedicated development URL locally. Migrate the intended database once as a controlled release step; migrations and seeds do **not** run during `next build` or application requests. No Neon resource has been provisioned by this code.

## Rules for subsequent phases

- Authorize each admin operation and protected data access on the server. Layout checks and hidden controls alone are insufficient.
- Use shared Zod schemas for external input and revalidate on the server. Add database constraints alongside validation.
- Products may have variants with their own SKU, barcode, price, cost, images, attributes and inventory. Monetary values must use integer centavos, never floating point.
- Inventory will use a stock movement ledger. Track on-hand and reserved stock; available equals on-hand minus reserved. Changes and reservations must use database transactions and concurrency controls to prevent overselling. Do not introduce a manually editable quantity as the only source of truth.
- Do not add commerce behavior until the corresponding phase is approved.

## Vercel (later)

1. Push this project to the GitHub repository and import it into Vercel.
2. Select the Next.js preset, Node.js 24, install command `npm ci` and build command `npm run build`. Use the repository root if the project is pushed as-is.
3. Keep `main` for production and use `staging` for preview work. For an initially empty repository, create a production branch when ready.
4. Add real credentials in Vercel per environment only when their integrations are implemented. Set the appropriate deployed auth URL then.

No deployment has been made as part of this foundation phase. No custom Vercel config is required.

## Foundation commands

The project was initialized with:

```bash
npx create-next-app@latest haus-of-dink --typescript --tailwind --eslint --app --src-dir --import-alias '@/*' --use-npm --disable-git --yes
npm install @neondatabase/serverless drizzle-orm better-auth @vercel/blob zod react-hook-form @hookform/resolvers@5 lucide-react server-only
npm install -D drizzle-kit
npm install @radix-ui/react-slot class-variance-authority clsx tailwind-merge tw-animate-css
```

The resolver uses the compatible v5 line: the v6 dependency tree had conflicting optional Effect peers during installation. No peer checks were bypassed.

The shadcn CLI initialization was attempted, but this environment could not connect to its registry. The project uses manual shadcn/ui setup with the New York/Radix component pattern, `components.json`, CSS variables, `cn`, and local Button, Badge and Card source. Additional components can be added with `npx shadcn@latest add <component>` in an environment with registry access.
