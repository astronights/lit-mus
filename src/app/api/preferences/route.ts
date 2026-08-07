import { eq } from "drizzle-orm";

import { db } from "@/db";
import { user as userTable, type UserPreferences } from "@/db/schema";
import { getCurrentUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";

const THEMES = new Set(["light", "dark", "system"]);
const PAIRINGS = new Set(["clean", "comic", "handwritten"]);

/**
 * Theme and font pairing sync (Section 5e).
 *
 * localStorage remains the source of truth for first paint -- it is what lets
 * the theme apply before the page renders, including for signed-out visitors.
 * This endpoint just carries the choice between devices. A lost preference is
 * a two-second re-pick, so nothing here is load-bearing.
 */
export async function GET() {
  const current = await getCurrentUser();
  if (!current) return unauthorized();

  const row = await db.query.user.findFirst({ where: eq(userTable.id, current.id) });
  return Response.json({ preferences: row?.preferences ?? {} });
}

export async function PUT(request: Request) {
  const current = await getCurrentUser();
  if (!current) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as Partial<UserPreferences>;
  const preferences: UserPreferences = {};

  if (typeof body.theme === "string" && THEMES.has(body.theme)) preferences.theme = body.theme;
  if (typeof body.fontPairing === "string" && PAIRINGS.has(body.fontPairing)) {
    preferences.fontPairing = body.fontPairing;
  }

  await db
    .update(userTable)
    .set({ preferences, updatedAt: new Date() })
    .where(eq(userTable.id, current.id));

  return Response.json({ preferences });
}
