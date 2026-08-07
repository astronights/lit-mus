import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

// argon2 is a native module: these routes must not run on the Edge runtime.
export const runtime = "nodejs";

export const { GET, POST } = toNextJsHandler(auth);
