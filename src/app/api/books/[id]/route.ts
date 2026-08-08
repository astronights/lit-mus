import { eq } from "drizzle-orm";

import { db } from "@/db";
import { books } from "@/db/schema";
import { getBookDetail } from "@/lib/books";
import { HydrationFailedError, hydrateBook } from "@/lib/hydrate";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
// Hydration can take a few seconds on a cold cache; the Hobby plan caps at 10.
export const maxDuration = 30;

/**
 * `GET /api/books/:id` -- the lazy hydrate-and-cache route (Section 3).
 *
 *   hydrated_at set  -> pure DB read, no external calls, ever again
 *   hydrated_at null -> fetch Open Library + Wikidata + Wikipedia, write, return
 *
 * Question generation is deliberately *not* here: it would add a second or two
 * on top of the fetches. The client fires `POST /api/books/:id/questions`
 * after this resolves, and the detail screen fills in the questions when it
 * lands.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let book = await db.query.books.findFirst({ where: eq(books.id, id) });
  if (!book) return Response.json({ error: "Not found" }, { status: 404 });

  if (!book.hydratedAt) {
    // Only cache misses are rate limited. A scripted loop over book ids could
    // otherwise burn Neon compute and the Gemini daily quota in minutes, while
    // ordinary browsing of already-hydrated books stays unthrottled.
    const limiter = await rateLimit(`hydrate:${clientIp(request.headers)}`, 20, 60);
    if (!limiter.ok) return rateLimitResponse(limiter);

    try {
      book = await hydrateBook(book);
    } catch (error) {
      if (error instanceof HydrationFailedError) {
        // Nothing was written and the book stays a cache miss, so a retry is
        // the honest thing to offer.
        return Response.json(
          { error: "Couldn't reach the book sources. Try again in a moment." },
          { status: 503 },
        );
      }
      throw error;
    }
  }

  // Hand over the row we already have: on the cached path this takes the
  // request from three sequential round trips to two.
  const detail = await getBookDetail(id, book);
  if (!detail) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({
    book: detail,
    // Tells the client whether to fire the background generation request.
    questionsPending: detail.questionsGeneratedAt === null,
  });
}
