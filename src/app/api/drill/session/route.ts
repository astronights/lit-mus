import { pickSessionBooks } from "@/lib/drill";
import { getCurrentUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";

/**
 * `GET /api/drill/session` -- the book ids for a session, in order.
 *
 * Ids only, deliberately. The card itself is fetched one at a time from
 * `/api/drill/card/:bookId`, because a book that has never been opened needs
 * Wikipedia and Gemini before it can be asked about, and doing that for a
 * whole session up front would mean a minute of staring at a spinner.
 *
 * It also keeps the titles off the client until the riddle has been played --
 * shipping the whole queue would put every answer in the network tab.
 *
 * Paged: the client asks for a couple at a time and passes back what it has
 * already had via `exclude`, so a session runs as long as you keep going
 * instead of ending at an arbitrary twelve.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const params = new URL(request.url).searchParams;
  const size = Math.min(Math.max(Number(params.get("size")) || 12, 1), 30);

  const exclude = (params.get("exclude") ?? "")
    .split(",")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
    // Bounded so a crafted request cannot build an enormous NOT IN clause.
    .slice(0, 500);

  return Response.json({ bookIds: await pickSessionBooks(user.id, size, exclude) });
}
