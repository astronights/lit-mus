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
 * `{ card: null, reason }` means the book could not produce a card. The client
 * usually drops it and moves on -- from the player's side that is just the next
 * book -- but the reason matters: `generation_unavailable` is a property of the
 * deployment rather than the book, so the client stops instead of hydrating
 * eleven more books to learn the same thing.
 *
 * This used to be a bare 204, which is why an unconfigured Gemini key showed up
 * as "nothing to drill" on a shelf of two thousand books.
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

  return Response.json(await loadDrillCard(user.id, bookId));
}
