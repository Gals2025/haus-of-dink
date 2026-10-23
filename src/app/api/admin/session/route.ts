import { NextResponse } from "next/server";
import { getStaffSession } from "@/server/auth/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getStaffSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ role: session.staff.role }, { headers: { "Cache-Control": "no-store" } });
}
