import { z } from "zod";

export const roles = ["staff", "admin", "super_admin"] as const;
export const userFilters = z.object({
  search: z.string().trim().max(100).default(""),
  role: z.enum(["all", ...roles]).default("all"),
  status: z.enum(["all", "active", "inactive"]).default("all"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
}).strict();
const expected = {
  targetId: z.string().min(1).max(200),
  expectedRole: z.enum(roles),
  expectedActive: z.boolean(),
};
export const userChange = z.discriminatedUnion("kind", [
  z.object({ ...expected, kind: z.literal("role"), role: z.enum(roles) }).strict(),
  z.object({ ...expected, kind: z.literal("status"), active: z.boolean() }).strict(),
]);
export type UserFilters = z.infer<typeof userFilters>;
export type UserChange = z.infer<typeof userChange>;
export type ManagedUser = { id: string; name: string; email: string; role: typeof roles[number]; active: boolean };
export type ChangeResult = { ok: true } | { ok: false; error: string };
export const pageSize = 25;
