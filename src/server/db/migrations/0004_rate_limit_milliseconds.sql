-- Better Auth's database limiter reads/writes numeric Unix milliseconds.
-- Preserve existing buckets, counts, and their window timestamps on upgrade.
-- Do not edit the previously tracked timestamptz migration.
ALTER TABLE "rate_limit"
  ALTER COLUMN "last_request" TYPE bigint
  USING floor(extract(epoch FROM "last_request") * 1000)::bigint;
