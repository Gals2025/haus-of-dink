import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/server/db/schema";
import { developmentCatalog as data } from "./seed-data";
import { createAuthorization, currentStaffSessionConditions, type AuthSession } from "../src/server/auth/authorize";
import type { CatalogStorage } from "../src/server/catalog/service";

// No network client or environment credentials: schema installation is confined
// to this new in-memory database, following the existing test-suite convention.
export async function catalogFixture() {
  const client = new PGlite(); const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  await db.insert(schema.brands).values(data.brands);
  await db.insert(schema.categories).values(data.categories);
  await db.insert(schema.products).values(data.products);
  await db.insert(schema.productVariants).values(data.variants);
  let identity: AuthSession | null = null;
  const authorization = createAuthorization({ redirect: () => { throw Error("Denied"); }, readSession: async () => identity,
    findStaff: async (who) => (await db.select({ id: schema.user.id, role: schema.user.role, active: schema.user.active })
      .from(schema.session).innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
      .where(currentStaffSessionConditions(who)).limit(1))[0],
  });
  async function signIn(role: "staff" | "admin" | "super_admin" = "admin") {
    const id = crypto.randomUUID();
    const [user] = await db.insert(schema.user).values({ id, name: "Catalog tester", email: `${id}@example.test`, role, active: true }).returning();
    const [session] = await db.insert(schema.session).values({ id, userId: id, token: crypto.randomUUID(), expiresAt: new Date(Date.now() + 3600000) }).returning();
    assert.ok(user && session); identity = { user, session }; return identity;
  }
  const storage: CatalogStorage = { authorize: authorization.getPermissionSession,
    read: async (query) => (await db.execute(query)).rows as never,
  };
  return { client, db, signIn, storage, data, schema };
}
