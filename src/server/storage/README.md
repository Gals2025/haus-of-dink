# Storage boundary

Payment proofs use a dedicated private Vercel Blob store. Configure its read/write token as `PAYMENT_PROOF_BLOB_READ_WRITE_TOKEN` in local and Vercel environments. Uploads accept JPEG, PNG, WebP, or PDF up to 8 MB; staff with `orders:read` can view them through the authenticated admin route. Never expose proof blob URLs on the storefront or use the public featured-image store for receipts.
