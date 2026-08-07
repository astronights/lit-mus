import { eq } from "drizzle-orm";

import { db } from "@/db";
import { books, characters, plotBlurbs, quizQuestions } from "@/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { GeminiError, generateJson, geminiModel, isGeminiConfigured } from "@/lib/questions/gemini";
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
  | { status: "failed"; reason: string };

/** Global ceiling, shared across every user and every function instance. */
function requestsPerMinute(): number {
  const configured = Number(process.env.GEMINI_MAX_REQUESTS_PER_MINUTE);
  return Number.isFinite(configured) && configured > 0 ? configured : 10;
}

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

  // The queue (Section 5d): a couple of people browsing new books at once can
  // outrun the free tier's per-minute cap, so the throttle is global rather
  // than per user. Being throttled is not an error -- we leave
  // `questions_generated_at` null and the next visit tries again.
  const budget = await rateLimit("gemini:generate", requestsPerMinute(), 60);
  if (!budget.ok) {
    return { status: "throttled", retryAfterSeconds: budget.resetSeconds };
  }

  const characterRows = await db.query.characters.findMany({
    where: eq(characters.bookId, bookId),
  });
  const characterNames = characterRows.map((row) => row.name);

  const { version, template } = loadPrompt();
  const prompt = renderPrompt(template, {
    title: book.title,
    author: book.author,
    characters: characterNames,
    sourceText: blurb.sourceExtract,
  });

  let validated: ValidatedQuestion[];
  try {
    validated = await generateAndValidate(prompt, {
      title: book.title,
      author: book.author,
      characterNames,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[questions] generation failed for book ${bookId}: ${reason}`);
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
        pendingReview: question.pendingReview,
      })),
    );
  }

  await markGenerated(bookId);
  return { status: "generated", count: validated.filter((q) => !q.pendingReview).length };
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
