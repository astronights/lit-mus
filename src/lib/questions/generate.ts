import { eq } from "drizzle-orm";

import { db } from "@/db";
import { books, plotBlurbs, quizQuestions } from "@/db/schema";
import { cooldownRemaining, markCooldown, rateLimit } from "@/lib/rate-limit";
import {
  GeminiError,
  generateJson,
  geminiModel,
  isGeminiConfigured,
  withGeminiTurn,
} from "@/lib/questions/gemini";
import { loadPrompt, renderPrompt } from "@/lib/questions/prompt";
import {
  QuestionParseError,
  parseGenerationResponse,
  validateQuestions,
  type ValidatedQuestion,
  type ValidationContext,
} from "@/lib/questions/validate";

/**
 * Background question generation.
 *
 * Never called from the request path (Section 5a): `/api/books/:id` returns
 * metadata, plot and characters immediately, and the client kicks this off
 * with a follow-up POST to `/api/books/:id/questions`.
 *
 * Generation is one-shot. A book with `questions_generated_at` set is done
 * forever -- the only way to revisit it is `scripts/backfill-questions.ts`,
 * which selects on `prompt_version`.
 */

export type GenerationOutcome =
  | { status: "generated"; count: number }
  | { status: "skipped"; reason: "already_generated" | "not_hydrated" | "no_plot" | "not_configured" }
  | { status: "throttled"; retryAfterSeconds: number }
  | { status: "quota_exceeded"; retryAfterSeconds: number }
  | { status: "failed"; reason: string };

/**
 * Published free-tier ceilings, per model.
 *
 * Here so that changing GEMINI_MODEL changes the budget with it: a limit tuned
 * for one model is worse than no limit on another -- too low wastes an
 * allowance we are paying attention to, too high just hands the 429 back to
 * Google. Google revises these, so the env vars below always win.
 */
const FREE_TIER: Record<string, { rpm: number; rpd: number }> = {
  "gemini-2.5-pro": { rpm: 5, rpd: 100 },
  "gemini-2.5-flash": { rpm: 10, rpd: 250 },
  "gemini-2.5-flash-lite": { rpm: 15, rpd: 1_000 },
  "gemini-2.0-flash": { rpm: 15, rpd: 200 },
  "gemini-2.0-flash-lite": { rpm: 30, rpd: 200 },
};

/** Conservative guess for a model we have no published numbers for. */
const UNKNOWN_MODEL = { rpm: 5, rpd: 100 };

function freeTierCeiling(): { rpm: number; rpd: number } {
  const model = geminiModel();
  // Longest matching prefix, so a dated variant lands on its own base model:
  // "gemini-2.5-flash-lite-preview-09-2025" starts with "gemini-2.5-flash"
  // too, and matching that would give it less than half its real allowance.
  const match = Object.keys(FREE_TIER)
    .filter((name) => model.startsWith(name))
    .sort((a, b) => b.length - a.length)[0];

  return match ? FREE_TIER[match] : UNKNOWN_MODEL;
}

/**
 * Global ceilings, shared across every user and every function instance --
 * provided Upstash is configured. Without it the limiter counts per function
 * instance, which on Vercel is close to no limit at all.
 */
function requestsPerMinute(): number {
  const configured = Number(process.env.GEMINI_MAX_REQUESTS_PER_MINUTE);
  return Number.isFinite(configured) && configured > 0 ? configured : freeTierCeiling().rpm;
}

/**
 * The daily cap the free tier actually enforces, and the one we had no guard
 * for at all. A per-minute limit does nothing to stop a session of twelve
 * cards, repeated a few times, walking straight through a day's allowance.
 */
function requestsPerDay(): number {
  const configured = Number(process.env.GEMINI_MAX_REQUESTS_PER_DAY);
  return Number.isFinite(configured) && configured > 0 ? configured : freeTierCeiling().rpd;
}

/** How long to stop asking after Gemini says the quota is gone. */
const QUOTA_COOLDOWN_SECONDS = 15 * 60;
const QUOTA_COOLDOWN_KEY = "gemini:quota-exhausted";

export async function generateQuestionsForBook(bookId: number): Promise<GenerationOutcome> {
  if (!isGeminiConfigured()) return { status: "skipped", reason: "not_configured" };

  const book = await db.query.books.findFirst({ where: eq(books.id, bookId) });
  if (!book) return { status: "failed", reason: "book not found" };
  if (!book.hydratedAt) return { status: "skipped", reason: "not_hydrated" };
  if (book.questionsGeneratedAt) return { status: "skipped", reason: "already_generated" };

  const blurb = await db.query.plotBlurbs.findFirst({ where: eq(plotBlurbs.bookId, bookId) });
  if (!blurb?.sourceExtract) {
    // No grounding text means no honest question. Mark it done so we stop
    // trying on every visit; the book simply shows no questions.
    await markGenerated(bookId);
    return { status: "skipped", reason: "no_plot" };
  }

  const characterNames = book.characters ?? [];

  /*
   * Everything from here on is serialised: one Gemini call at a time, never
   * two in parallel. The gates are inside the turn on purpose -- a caller that
   * waited its turn must re-read the cooldown, because the call ahead of it may
   * have just discovered the quota is gone.
   */
  return withGeminiTurn(() =>
    askGemini(bookId, {
      title: book.title,
      author: book.author,
      characterNames,
      sourceText: blurb.sourceExtract,
    }),
  );
}

type GenerationInput = ValidationContext & { sourceText: string };

async function askGemini(bookId: number, input: GenerationInput): Promise<GenerationOutcome> {
  /*
   * Three gates before spending a call, in cost order.
   *
   * The cooldown comes first: once Gemini has returned 429 the quota is gone,
   * and every further request burns a round trip, makes the player wait, and
   * tells us nothing new.
   */
  const cooling = await cooldownRemaining(QUOTA_COOLDOWN_KEY);
  if (cooling > 0) return { status: "quota_exceeded", retryAfterSeconds: cooling };

  const daily = await rateLimit("gemini:daily", requestsPerDay(), 24 * 60 * 60);
  if (!daily.ok) {
    return { status: "quota_exceeded", retryAfterSeconds: daily.resetSeconds };
  }

  // Being throttled is not an error -- `questions_generated_at` stays null and
  // the next visit tries again.
  const budget = await rateLimit("gemini:generate", requestsPerMinute(), 60);
  if (!budget.ok) {
    return { status: "throttled", retryAfterSeconds: budget.resetSeconds };
  }

  const { characterNames, sourceText, ...book } = input;

  const { version, template } = loadPrompt();
  const prompt = renderPrompt(template, {
    title: book.title,
    author: book.author,
    characters: characterNames,
    sourceText,
  });

  let validated: ValidatedQuestion[];
  try {
    validated = await generateAndValidate(prompt, { ...book, characterNames });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[questions] generation failed for book ${bookId}: ${reason}`);

    // A 429 is the quota, not this book. Stop asking for a while: without this
    // every subsequent card repeated the same doomed call, which is how a
    // single exhausted quota turned into twelve slow failures in a row.
    if (error instanceof GeminiError && error.status === 429) {
      await markCooldown(QUOTA_COOLDOWN_KEY, QUOTA_COOLDOWN_SECONDS);
      return { status: "quota_exceeded", retryAfterSeconds: QUOTA_COOLDOWN_SECONDS };
    }

    // Deliberately leave `questions_generated_at` null: a transient Gemini
    // failure should not permanently cost the book its questions.
    return { status: "failed", reason };
  }

  if (validated.length > 0) {
    await db.insert(quizQuestions).values(
      validated.map((question) => ({
        bookId,
        type: question.type,
        questionText: question.questionText,
        answer: question.answer,
        generatedBy: geminiModel(),
        promptVersion: version,
      })),
    );
  }

  await markGenerated(bookId);
  return { status: "generated", count: validated.length };
}

/**
 * One call, with a single retry on malformed JSON.
 *
 * The retry matters more than it looks: generation is one-shot, so a JSON blip
 * would otherwise cost the book its questions permanently.
 */
async function generateAndValidate(
  prompt: string,
  context: ValidationContext,
): Promise<ValidatedQuestion[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await generateJson(prompt);
    try {
      return validateQuestions(parseGenerationResponse(raw), context);
    } catch (error) {
      if (error instanceof QuestionParseError && attempt === 0) {
        console.warn(`[questions] malformed JSON, retrying once: ${error.message}`);
        continue;
      }
      throw error;
    }
  }
  throw new GeminiError("unreachable");
}

async function markGenerated(bookId: number): Promise<void> {
  await db.update(books).set({ questionsGeneratedAt: new Date() }).where(eq(books.id, bookId));
}
