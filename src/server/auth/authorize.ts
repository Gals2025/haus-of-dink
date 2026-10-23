import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { user } from "@/server/db/schema";

export async function getStaffSession() {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const [staff] = await getDb().select({ id: user.id, active: user.active, role: user.role })
    .from(user).where(eq(user.id, session.user.id)).limit(1);
  if (!staff?.active || !["staff", "admin", "super_admin"].includes(staff.role)) return null;
  return { ...session, staff };
}

export async function requireStaff() {
  const session = await getStaffSession();
  if (!session) redirect("/admin/login");
  return session;
}

export async function requireSuperAdmin() {
  const session = await requireStaff();
  if (session.staff.role !== "super_admin") redirect("/admin");
  return session;
}
