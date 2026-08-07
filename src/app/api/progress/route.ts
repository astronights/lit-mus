import { listCategories } from "@/lib/books";
import { getProgress } from "@/lib/drill";
import { getCurrentUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
// Never prerendered: this reads the database on every request.
export const dynamic = "force-dynamic";

/**
 * `GET /api/progress` -- coverage and box distribution (Section 5b, Tab 4).
 *
 * Coverage is global (books hydrated per category) while the box numbers are
 * per user, which mirrors how the data actually splits: hydration is paid once
 * for everyone, scheduling belongs to you.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const [progress, categories] = await Promise.all([getProgress(user.id), listCategories()]);

  return Response.json({ ...progress, categories });
}
