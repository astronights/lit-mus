import { loadDrillCard } from "@/lib/drill";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getCurrentUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
// Hydration is up to three external round trips and generation is a Gemini
// call, so a first-time card is genuinely slow. Every later one is a DB read.
export const maxDuration = 60;

/**
 * `GET /api/drill/card/:bookId` -- one drill card, fetching whatever the book
 * still needs first.
 *
 * A 204 means the book cannot produce a card (too thin an article, or every
 * source was unreachable). The client drops it and moves to the next id rather
 * than showing an error: from the player's side it is just the next book.
 */
export async function GET(request: Request, context: { params: Promise<{ bookId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { bookId: raw } = await context.params;
  const bookId = Number(raw);
  if (!Number.isInteger(bookId) || bookId <= 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Generous, since a session legitimately walks through cards one after
  // another; this is here to stop a script driving the Gemini quota, not to
  // pace a person.
  const limiter = await rateLimit(`drill:card:${clientIp(request.headers)}`, 60, 60);
  if (!limiter.ok) return rateLimitResponse(limiter);

  const card = await loadDrillCard(user.id, bookId);
  if (!card) return new Response(null, { status: 204 });

  return Response.json({ card });
}
