import { buildSession } from "@/lib/drill";
import { getCurrentUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";

/** `GET /api/drill/session` -- a composed session queue. Requires sign-in. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const size = Math.min(Math.max(Number(new URL(request.url).searchParams.get("size")) || 12, 1), 30);
  const cards = await buildSession(user.id, size);

  return Response.json({ cards });
}
