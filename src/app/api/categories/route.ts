import { listCategories } from "@/lib/books";

export const runtime = "nodejs";
// Never prerendered: this reads the database on every request.
export const dynamic = "force-dynamic";

/** `GET /api/categories` -- category list with seeded and opened counts. */
export async function GET() {
  return Response.json({ categories: await listCategories() });
}
