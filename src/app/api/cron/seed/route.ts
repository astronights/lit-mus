import { runSeed } from "@/lib/seed";
import { enabledSources } from "@/lib/seed-sources";
import { timingSafeEqual } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * `POST /api/cron/seed` -- the seed job as a Vercel Cron target.
 *
 * Equivalent to `npm run seed`; use whichever is convenient. Guarded by
 * `CRON_SECRET` because it is a public URL that does real work: Vercel Cron
 * sends it as `Authorization: Bearer <secret>`.
 *
 * The whole seed can exceed even a Pro function's limit once every source is
 * enabled, so prefer running one source per invocation via `?sources=booker`.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }

  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!timingSafeEqual(supplied, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const filter = new URL(request.url).searchParams.get("sources") ?? undefined;
  const sources = enabledSources(filter);

  const reports = await runSeed({ sources, onProgress: (message) => console.log(message) });
  return Response.json({ reports });
}
