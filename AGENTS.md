<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Repository workflow

The owner has selected `main` as the working and production branch. Make future changes directly on `main`; do not switch to `staging` unless explicitly requested. Before pushing, run typecheck, lint, auth tests, database tests, migration checks, inventory tests and build. Database migrations require an identified target database and must never run automatically during a build or page request.
