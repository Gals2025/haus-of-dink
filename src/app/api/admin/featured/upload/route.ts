import { handleUpload } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getPermissionSession } from "@/server/auth/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/avif"];

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const session = await getPermissionSession("promotions:write");
        if (!session) throw new Error("You need promotion edit access to upload images.");
        if (!pathname.startsWith("featured/")) throw new Error("Invalid featured image path.");
        return {
          allowedContentTypes: imageTypes,
          maximumSizeInBytes: 10 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: session.user.id }),
        };
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload could not be authorized.";
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
