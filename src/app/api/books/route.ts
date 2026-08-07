import { listBooks, searchBooks } from "@/lib/books";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * `GET /api/books` -- browse the seeded set.
 * `GET /api/books?search=...` -- title/author search (Section 5b, Tab 2).
 *
 * Ungated: book content is shared, not personal, and there is no sign-up wall
 * on the part of the app that's useful on first visit.
 */
export async function GET(request: Request) {
  const limiter = await rateLimit(`books:list:${clientIp(request.headers)}`, 120, 60);
  if (!limiter.ok) return rateLimitResponse(limiter);

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim();
  const limit = clampNumber(url.searchParams.get("limit"), 50, 1, 200);
  const offset = clampNumber(url.searchParams.get("offset"), 0, 0, 100_000);

  const results = search ? await searchBooks(search, limit) : await listBooks(limit, offset);

  return Response.json({ books: results });
}

function clampNumber(raw: string | null, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
