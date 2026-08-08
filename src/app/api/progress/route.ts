import { getProgress } from "@/lib/drill";
import { getCurrentUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
// Never prerendered: this reads the database on every request.
export const dynamic = "force-dynamic";

/**
 * `GET /api/progress` -- coverage and box distribution (Section 5b, Tab 4).
 *
 * Box counts only. The coverage panel is gone -- how much of each category you
 * had opened stopped meaning anything once Drill drew from the whole shelf
 * rather than from books you had browsed.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  return Response.json(await getProgress(user.id));
}
