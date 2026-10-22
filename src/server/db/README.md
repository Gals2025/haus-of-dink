# Catalog database boundary

All runtime access belongs in this server-only directory. Import `getDb()` from `@/server/db` in server modules. It validates server environment configuration on first use and caches a lightweight Neon HTTP/Drizzle client, not a TCP pool. Static builds do not require credentials. Drizzle Kit and seed commands load `.env.local` using Next.js environment loading; shell variables take precedence. Never enable SQL/parameter logging for requests containing sensitive data.

## Tables and relationships

Every table has a UUID primary key, `created_at` and `updated_at` as timezone-aware PostgreSQL timestamps. UUID defaults use `gen_random_uuid()`; no extension setup is needed on Neon. Database triggers maintain `updated_at`, including writes outside Drizzle.

| Table | Purpose and relationships |
| --- | --- |
| `brands` | Name, unique slug, description, website/logo URLs, active/inactive status. One brand has many products. |
| `categories` | Name, unique slug, description, status, optional parent. Parent deletion is restricted. Self-parenting and indirect cycles are rejected. |
| `products` | Name, slug, long/short description, required brand/category, draft/active/archived status, featured/new-arrival flags. No stock or price fields. |
| `product_variants` | Sellable SKU, optional barcode, integer price/compare-at/cost, currency (default PHP), active/inactive status. Belongs to one product. |
| `product_images` | Product, optional variant, HTTPS Blob URL, required alt text, primary flag and non-negative sort order. |
| `attributes` | Flexible named definitions with unique slug and optional unit, such as Thickness/mm or Color. |
| `attribute_values` | Reusable named values belonging to one attribute, with slug and sort order. |
| `product_attribute_values` | Product specifications when variant is null; variant-specific options when populated. Links to one attribute/value pair. |

Deleting a product cascades to variants, images and attribute assignments. Deleting a variant cascades only to its images and assignments. Referenced brands, categories, attributes and values are protected with `RESTRICT`; prefer inactive/archived statuses to deleting business records. Composite foreign keys enforce that a variant belongs to the same product as its images/attribute assignments and that a value belongs to the stated attribute.

Products can have several values for an attribute (for example multiple materials). A variant has at most one value per attribute. Variant assignments take precedence over product specifications when displaying the same attribute; future catalog services must implement that resolution. The schema does not yet enforce distinct complete option combinations or an active product's minimum number of variants; those depend on future product publishing rules. There is no variant-to-inventory link in this phase.

Primary images are **at most one** for the product gallery and at most one for each variant gallery. A gallery may be empty or have no designated primary; future readers should fall back to `sort_order, id`. Blob URLs are HTTPS URLs, with no fabricated upload credentials. HTTPS checks are not an upload authorization mechanism; authorized upload and URL provenance validation belong in the future storage service.

Prices, costs and compare-at prices are PostgreSQL `integer` minor units: PHP 1,500.00 is `150000`. Negative money and fractional integers are rejected; compare-at must be null or at least the selling price. The supported maximum is 2,147,483,647 minor units per field (PHP 21,474,836.47). Currency is an uppercase three-letter code, default `PHP`; future validation must constrain supported currencies and prevent mixed-currency totals. A nullable cost means unknown, not zero. Barcodes are strings, preserving leading zeroes.

## Indexes and constraints

Primary keys and unique constraints create supporting B-tree indexes automatically.

| Table | Additional lookup / uniqueness indexes |
| --- | --- |
| `brands` | Unique slug; unique case-insensitive name. |
| `categories` | Unique slug; `(parent_id, status)` for hierarchy and FK lookups. |
| `products` | Unique slug; `(brand_id, status)`, `(category_id, status)`, `(status, created_at)`; partial active featured/new-arrival indexes on `created_at`. |
| `product_variants` | Case-insensitive globally unique SKU; unique non-null barcode; unique `(product_id, id)` for composite references; `(product_id, status)`. |
| `product_images` | `(product_id, sort_order, id)`, `(variant_id, sort_order, id)`; partial unique primary-image indexes per product/variant scope. |
| `attributes` | Unique slug; unique case-insensitive name. |
| `attribute_values` | Unique `(attribute_id, slug)`, `(attribute_id, id)` and case-insensitive `(attribute_id, value)`. |
| `product_attribute_values` | Unique product/value for product-level rows; unique variant/attribute for variant-level rows; product lookup and `(attribute_id, attribute_value_id, product_id)` for filtering and FK lookups. |

Slugs are canonical lowercase kebab-case. Names and values cannot be blank. SKUs and barcodes cannot have leading/trailing spaces. Categories support arbitrary depth; hierarchy writes use an advisory transaction lock and a recursive cycle check. Use PostgreSQL's default READ COMMITTED isolation for hierarchy changes; retry deadlock/serialization failures in future mutation services. Status fields use PostgreSQL enums, so future status changes require migrations.

## Commands

Run from the repository root with Node.js 24 and npm:

```bash
npm run db:generate -- --name=describe_change # offline: generate SQL/snapshot
npm run db:check                           # offline: check migration history
npm run db:test                            # offline: PostgreSQL migration/constraint tests
npm run db:migrate                         # apply tracked migrations to DATABASE_URL
npm run db:seed                            # development fixtures only
```

`drizzle.config.ts` points to `schema/index.ts` and `migrations/`. Migration bookkeeping uses `drizzle.__drizzle_migrations`. Both generated and custom SQL migrations are required; `db:push` is deliberately not provided because it bypasses reviewed SQL and would omit custom triggers.

The HTTP client supports atomic `db.batch()` operations; `db.transaction(async tx => ...)` is not supported by Neon HTTP. A future inventory phase must select a transaction-capable driver when interactive transactions are needed. Do not add socket pools with lifecycle assumptions that span Vercel function invocations.

The PGlite tests apply and reapply the tracked migrations to isolated PostgreSQL, seed twice, and check relational queries, money validation, ownership, uniqueness, category cycles, timestamp triggers, restrictions and cascading deletes. They do not test live Neon transport, Vercel integration, or concurrent multi-session writes. Migration and seed execution against Neon requires manual account/project/database setup described in the root README.
