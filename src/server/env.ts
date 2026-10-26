import "server-only";
import { z } from "zod";

// Validate lazily: static pages do not require unimplemented integrations.
const serverEnvSchema = z.object({
  DATABASE_URL: z
    .url()
    .refine(
      (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
      "Expected a PostgreSQL URL",
    )
    .optional(),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: z.url().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  AUTH_EMAIL_FROM: z.email().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
});

export function getServerEnv() {
  const parsed = serverEnvSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL || undefined,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || undefined,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || undefined,
    RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
    AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM || undefined,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN || undefined,
  });
  if (!parsed.success) {
    // Do not include invalid input values in errors or logs.
    const keys = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
    ];
    throw new Error(
      `Invalid server environment configuration: ${keys.join(", ")}`,
    );
  }
  return parsed.data;
}
