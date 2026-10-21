# Haus of Dink

Phase-one foundation for a pickleball storefront and management portal, intended for Vercel.

## Scope

Implemented: Next.js App Router, strict TypeScript, Tailwind CSS, shadcn/ui, responsive storefront and admin layouts, and placeholder routes `/`, `/shop`, `/admin`.

No database schema, migrations, authentication, inventory, cart, checkout, orders, payments, or promotions are implemented. `/admin` is a public preview containing no sensitive data or actions. It is not a secure admin portal yet.

## Local development

Use Node.js 24 (`nvm use`) and npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Credentials are optional for this phase; all three routes build and render without them.

```bash
npm run typecheck
npm run lint
npm run build
npm start
```

`typecheck` generates Next.js route types before running TypeScript. Lint treats warnings as failures. No test suite exists yet: this phase contains static layouts rather than commerce behavior. Use the checks above and smoke-test all three routes.

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
| `src/server/db/`         | Reserved centralized Neon/Drizzle access and transactions                        |
| `src/server/auth/`       | Reserved Better Auth and centralized authorization                               |
| `src/server/storage/`    | Reserved server-side Vercel Blob operations                                      |

Pages and layouts are Server Components by default. Add client components only for browser interaction; keep business rules outside UI. shadcn components are owned source, configured in `components.json`; Tailwind v4 theme tokens live in `src/app/globals.css`. The theme uses local system fonts so builds do not fetch remote fonts. The npm lockfile records the exact dependency tree.

The installed future integration packages do not create active services. No database, auth or Blob client is initialized. Drizzle Kit is installed but deliberately has no schema, configuration or migration scripts until the database phase.

## Environment variables

All variables below are server-only and optional **in phase one**. `.env.example` contains empty placeholders rather than credentials. Never add `NEXT_PUBLIC_` to these names, commit `.env.local`, or expose parsed server configuration to client components.

| Variable                | Purpose when its integration is implemented                               |
| ----------------------- | ------------------------------------------------------------------------- |
| `DATABASE_URL`          | Neon PostgreSQL connection URL; use separate staging/production databases |
| `BETTER_AUTH_SECRET`    | Random authentication secret of at least 32 characters                    |
| `BETTER_AUTH_URL`       | Auth application's origin; local default `http://localhost:3000`          |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token for authorized product-image uploads                    |

`getServerEnv()` validates supplied values lazily; it does not assert that integrations are configured. Future integration modules must require their own credentials before use, failing closed. Import `server-only` in all runtime server modules.

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
