# Feature organization

Add feature folders as functionality is approved (for example `products/components`, `products/schemas`, `products/server`). Keep orchestration and business rules outside route UI. Server modules must import `server-only` and use centralized database access and authorization. No commerce modules are implemented in phase one.
