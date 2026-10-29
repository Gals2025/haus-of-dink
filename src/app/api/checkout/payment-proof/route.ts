import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const maxSize = 8 * 1024 * 1024;
const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export async function POST(request: Request) {
  const origin=request.headers.get("origin");
  if(!origin || origin!==new URL(request.url).origin) return NextResponse.json({error:"Invalid request origin."},{status:403});
  const form = await request.formData();
  const file = form.get("proof");
  if (!(file instanceof File) || !allowed.has(file.type) || file.size < 1 || file.size > maxSize) {
    return NextResponse.json({ error: "Upload a JPEG, PNG, WebP, or PDF file under 8 MB." }, { status: 400 });
  }
  const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());
  const signatures:Record<string,boolean>={
    "image/jpeg":bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff,
    "image/png":bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47,
    "image/webp":String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP",
    "application/pdf":String.fromCharCode(...bytes.slice(0,4))==="%PDF",
  };
  if(!signatures[file.type]) return NextResponse.json({error:"The uploaded file does not match its declared type."},{status:400});
  const h=await headers();const source=process.env.VERCEL?h.get("x-vercel-forwarded-for")??"unknown":"local";
  const rateKey=`proof:${createHash("sha256").update(source).digest("hex")}`;
  const throttle=await getDb().execute<{count:number}>(sql`insert into rate_limit(id,key,count,last_request) values(${rateKey},${rateKey},1,(extract(epoch from clock_timestamp())*1000)::bigint)
    on conflict(key) do update set count=case when rate_limit.last_request<(extract(epoch from clock_timestamp())*1000)::bigint-600000 then 1 else rate_limit.count+1 end,
    last_request=(extract(epoch from clock_timestamp())*1000)::bigint returning count`);
  if(Number(throttle.rows[0]?.count??0)>6) return NextResponse.json({error:"Upload limit reached. Try again later."},{status:429});
  const token = process.env.PAYMENT_PROOF_BLOB_READ_WRITE_TOKEN;
  if (!token) return NextResponse.json({ error: "Payment proof storage is not configured." }, { status: 503 });
  try {
    const pathname = `payment-proofs/${crypto.randomUUID()}`;
    const blob = await put(pathname, file, { access: "private", addRandomSuffix: false, contentType: file.type, token });
    return NextResponse.json({ path: blob.pathname }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not store the proof. Please retry." }, { status: 503 });
  }
}
