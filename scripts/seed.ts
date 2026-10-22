import { loadEnvConfig } from "@next/env";
import { developmentCatalog as data } from "./seed-data";
import * as schema from "../src/server/db/schema";

async function main() {
  loadEnvConfig(process.cwd());
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development seed is disabled in production.");
  }
  const { getDb } = await import("../src/server/db");
  const db = getDb();
  // One atomic HTTP transaction; reruns skip only the stable fixture UUIDs.
  // Other unique conflicts deliberately fail instead of modifying real records.
  await db.batch([
    db.insert(schema.brands).values(data.brands).onConflictDoNothing({ target: schema.brands.id }),
    db.insert(schema.categories).values(data.categories).onConflictDoNothing({ target: schema.categories.id }),
    db.insert(schema.attributes).values(data.attributes).onConflictDoNothing({ target: schema.attributes.id }),
    db.insert(schema.attributeValues).values(data.attributeValues).onConflictDoNothing({ target: schema.attributeValues.id }),
    db.insert(schema.products).values(data.products).onConflictDoNothing({ target: schema.products.id }),
    db.insert(schema.productVariants).values(data.variants).onConflictDoNothing({ target: schema.productVariants.id }),
    db.insert(schema.productAttributeValues).values(data.assignments).onConflictDoNothing({ target: schema.productAttributeValues.id }),
  ]);
  console.info("Development catalog seeded: 5 brands, 6 categories, 7 products, 9 variants, 9 attributes, 13 values, 15 assignments. Existing fixtures preserved.");
}

main().catch(() => {
  // Driver errors may include SQL, connection details, or seed data.
  console.error("Development seed failed. Check DATABASE_URL, applied migrations, environment, and catalog conflicts.");
  process.exitCode = 1;
});
