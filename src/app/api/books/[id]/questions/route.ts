import { getBookDetail } from "@/lib/books";
import { generateQuestionsForBook } from "@/lib/questions/generate";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * `POST /api/books/:id/questions` -- the background generation job.
 *
 * Called by the client once the detail screen has rendered, so the Gemini call
 * never sits inside the first-paint path. Safe to call repeatedly: generation
 * refuses to run when `questions_generated_at` is already set, and the global
 * queue throttle keeps concurrent callers inside the free tier.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const limiter = await rateLimit(`questions:${clientIp(request.headers)}`, 20, 60);
  if (!limiter.ok) return rateLimitResponse(limiter);

  const outcome = await generateQuestionsForBook(id);

  // Throttled is a "come back shortly", not a failure: questions_generated_at
  // stays null so the next visit tries again.
  const status = outcome.status === "throttled" ? 202 : 200;

  const detail = await getBookDetail(id);
  return Response.json({ outcome, questions: detail?.questions ?? [] }, { status });
}
