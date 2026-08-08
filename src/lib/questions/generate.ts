import { eq } from "drizzle-orm";

import { db } from "@/db";
import { books, plotBlurbs, quizQuestions } from "@/db/schema";
import { cooldownRemaining, markCooldown, rateLimit } from "@/lib/rate-limit";
import {
  GeminiError,
  generateJson,
  isGeminiConfigured,
  quotaCooldown,
  resolveModel,
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

/*
 * Defaults, deliberately not a table of per-model free-tier quotas.
 *
 * A previous version kept one. It was the wrong shape: model ids move (the 3.x
 * family switched to a dotted scheme mid-life), Google revises the numbers, and
 * the free-tier cap is per *project* anyway -- it varies with region, account
 * age and whether billing is attached. A hard-coded table is therefore wrong in
 * a way nobody notices: too low silently wastes an allowance we are going out
 * of our way to husband, too high just hands the 429 back to Google.
 *
 * So the local budget is a model-agnostic runaway-loop guard, not a mirror of
 * anyone's quota, and the real enforcement is Google's own 429 -- which now
 * tells us how long to wait and which ceiling we hit (see quotaCooldown).
 *
 * Set generously on purpose. Now that a 429 is handled properly, refusing a
 * call the project's real allowance would have permitted is the worse of the
 * two errors: Google's answer is authoritative, arrives with its own retry
 * delay, and costs exactly one wasted call to learn. A local limit that fires
 * first just makes the app quieter than it needs to be -- an earlier, tighter
 * pair of defaults tripped the per-minute one during ordinary play.
 *
 * Set the env vars to the number AI Studio shows for your project;
 * `npm run check:models` prints the ids that key can use.
 */
const DEFAULT_REQUESTS_PER_MINUTE = 10;
const DEFAULT_REQUESTS_PER_DAY = 250;

/**
 * Global ceilings, shared across every user and every function instance --
 * provided Upstash is configured. Without it the limiter counts per function
 * instance, which on Vercel is close to no limit at all.
 */
function requestsPerMinute(): number {
  const configured = Number(process.env.GEMINI_MAX_REQUESTS_PER_MINUTE);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_REQUESTS_PER_MINUTE;
}

/**
 * The daily cap the free tier actually enforces, and the one we had no guard
 * for at all. A per-minute limit does nothing to stop a session of twelve
 * cards, repeated a few times, walking straight through a day's allowance.
 */
function requestsPerDay(): number {
  const configured = Number(process.env.GEMINI_MAX_REQUESTS_PER_DAY);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_REQUESTS_PER_DAY;
}

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
      const cooldown = quotaCooldown(error);
      await markCooldown(QUOTA_COOLDOWN_KEY, cooldown);
      return { status: "quota_exceeded", retryAfterSeconds: cooldown };
    }

    // Deliberately leave `questions_generated_at` null: a transient Gemini
    // failure should not permanently cost the book its questions.
    return { status: "failed", reason };
  }

  if (validated.length > 0) {
    // Cached after the first call, so this is not a per-book round trip.
    const model = await resolveModel();

    await db.insert(quizQuestions).values(
      validated.map((question) => ({
        bookId,
        type: question.type,
        questionText: question.questionText,
        answer: question.answer,
        generatedBy: model,
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
 *
 * It retries only `QuestionParseError`, which is the genuinely random failure.
 * A truncated response arrives as a `GeminiError` instead and is not retried on
 * purpose -- identical parameters reproduce a truncation exactly, so the second
 * call failed at almost the same character and cost a slot of a small daily
 * quota to learn nothing.
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
        // The snippet is the useful half: the message says where parsing gave
        // up, the text says what it gave up on.
        console.warn(
          `[questions] malformed JSON, retrying once: ${error.message}\n` +
            `  raw: ${raw.slice(0, 200).replace(/\s+/g, " ")}`,
        );
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
