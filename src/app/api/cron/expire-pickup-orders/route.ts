import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const secret=process.env.CRON_SECRET;
  const supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"") ?? "";
  if(!secret || supplied.length!==secret.length || !timingSafeEqual(Buffer.from(supplied),Buffer.from(secret))) return NextResponse.json({error:"Unauthorized"},{status:401});
  const result=await getDb().execute<{expired:number}>(sql`select expire_pickup_orders() as expired`);
  return NextResponse.json({expired:result.rows[0]?.expired ?? 0},{headers:{"Cache-Control":"no-store"}});
}
