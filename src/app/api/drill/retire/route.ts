import { retireBook } from "@/lib/drill";
import { getCurrentUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";

/**
 * `POST /api/drill/retire` -- "I've got this, stop showing me."
 *
 * The one permanent retirement in the app, and it is a choice rather than
 * something inferred from three clean passes. Reversible by posting
 * `{ retired: false }`.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as {
    bookId?: unknown;
    retired?: unknown;
  };

  const bookId = Number(body.bookId);
  if (!Number.isInteger(bookId) || bookId <= 0) {
    return Response.json({ error: "bookId is required" }, { status: 400 });
  }

  await retireBook(user.id, bookId, body.retired !== false);
  return Response.json({ ok: true });
}
