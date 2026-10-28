import { issueSignedToken, parseStoreIdFromDelegationToken, presignUrl } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPermissionSession } from "@/server/auth/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
const maxImageSize = 10 * 1024 * 1024;
const requestSchema = z.strictObject({
  contentType: z.enum(imageTypes),
  size: z.number().int().positive().max(maxImageSize),
});
const imageExtension: Record<(typeof imageTypes)[number], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export async function POST(request: Request) {
  const session = await getPermissionSession("promotions:write");
  if (!session) {
    return NextResponse.json({ error: "You need promotion edit access to upload images." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Choose a JPEG, PNG, WebP, or AVIF image under 10 MB." }, { status: 400 });
    }

    const { contentType, size } = parsed.data;
    const pathname = `featured/${crypto.randomUUID()}.${imageExtension[contentType]}`;
    const validUntil = Date.now() + 5 * 60 * 1000;
    const signedToken = await issueSignedToken({
      pathname,
      operations: ["put"],
      validUntil,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: Math.min(size, maxImageSize),
    });
    const { presignedUrl } = await presignUrl(signedToken, {
      operation: "put",
      pathname,
      access: "public",
      validUntil,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: Math.min(size, maxImageSize),
    });
    const storeId = parseStoreIdFromDelegationToken(signedToken.delegationToken);
    if (!storeId) throw new Error("Blob storage did not return a store identifier.");

    return NextResponse.json({
      uploadUrl: presignedUrl,
      imageUrl: `https://${storeId}.public.blob.vercel-storage.com/${pathname}`,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload could not be authorized.";
    const storageNotConfigured = /No blob credentials found|No read-write token found|no storeId was found/i.test(message);
    return NextResponse.json({
      error: storageNotConfigured
        ? "Vercel Blob is not connected to this deployment. Connect the Blob store to the Vercel project and try again."
        : "Could not prepare the image upload. Check the Vercel Blob store configuration and try again.",
    }, { status: storageNotConfigured ? 503 : 400, headers: { "Cache-Control": "no-store" } });
  }
}
