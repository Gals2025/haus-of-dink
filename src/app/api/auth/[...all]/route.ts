import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Initialize at request time; build-time route discovery needs no auth secrets.
export const { GET, POST } = toNextJsHandler(async (request) => {
  try {
    return await getAuth().handler(request);
  } catch {
    // Next.js must not log raw database/auth errors containing token parameters.
    return Response.json({ message: "Authentication is temporarily unavailable." }, { status: 503 });
  }
});
