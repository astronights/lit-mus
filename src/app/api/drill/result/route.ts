import { recordCardResult } from "@/lib/drill";
import type { DrillOutcome } from "@/lib/leitner";
import { getCurrentUser, unauthorized } from "@/lib/session";

export const runtime = "nodejs";

type Body = {
  bookId?: unknown;
  answers?: unknown;
};

/**
 * `POST /api/drill/result` -- record one finished card.
 *
 * The body carries only *answered* questions. Skips are absent rather than
 * sent as a third outcome, which is what keeps them neutral end to end.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bookId = Number(body.bookId);
  if (!Number.isInteger(bookId) || bookId <= 0) {
    return Response.json({ error: "bookId is required" }, { status: 400 });
  }

  const rawAnswers = Array.isArray(body.answers) ? body.answers : [];
  const answers = rawAnswers.flatMap((entry) => {
    const record = entry as { questionId?: unknown; outcome?: unknown };
    const questionId = Number(record.questionId);
    const outcome = record.outcome;
    if (outcome !== "got_it" && outcome !== "missed") return [];
    if (!Number.isInteger(questionId)) return [];
    return [{ questionId, outcome } satisfies { questionId: number; outcome: DrillOutcome }];
  });

  const outcome = await recordCardResult(user.id, { bookId, answers });
  return Response.json(outcome);
}
