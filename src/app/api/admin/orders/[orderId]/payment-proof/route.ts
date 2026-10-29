import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getPermissionSession } from "@/server/auth/authorize";
import { getDb } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await getPermissionSession("orders:read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orderId } = await params;
  if (!z.uuid().safeParse(orderId).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const row = (await getDb().execute<{ path: string | null }>(sql`select payment_proof_path as path from orders where id=${orderId}::uuid`)).rows[0];
  if (!row?.path) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const token = process.env.PAYMENT_PROOF_BLOB_READ_WRITE_TOKEN;
  if (!token) return NextResponse.json({ error: "Proof storage is unavailable" }, { status: 503 });
  try {
    const blob = await get(row.path, { access: "private", token });
    if (!blob || blob.statusCode !== 200) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return new Response(blob.stream, { headers: { "Content-Type": blob.blob.contentType, "Content-Length": String(blob.blob.size), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
  } catch { return NextResponse.json({ error: "Unable to read proof" }, { status: 503 }); }
}
