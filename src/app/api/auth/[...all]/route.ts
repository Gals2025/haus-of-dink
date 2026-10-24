import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Initialize at request time; build-time route discovery needs no auth secrets.
export const { GET, POST } = toNextJsHandler((request) => getAuth().handler(request));
