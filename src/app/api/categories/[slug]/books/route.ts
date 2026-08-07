import { listCategoryBooks } from "@/lib/books";

export const runtime = "nodejs";

/**
 * `GET /api/categories/:slug/books`
 *
 * Slug rather than the numeric id the design doc sketched: category slugs are
 * the seed source ids, so `/api/categories/booker/books` is readable in a log
 * and stable across a database rebuild.
 */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 500);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  return Response.json({ books: await listCategoryBooks(slug, limit, offset) });
}
