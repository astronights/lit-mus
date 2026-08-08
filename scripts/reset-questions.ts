/**
 * Delete generated questions so they are written again under the current prompt.
 *
 *   npm run questions:reset                              # every book
 *   npm run questions:reset -- --prompt-version 2026-08-07.1
 *   npm run questions:reset -- --book 42
 *   npm run questions:reset -- --dry-run
 *
 * This is the prompt-tuning loop: reset, open a book in the app, read what
 * comes back, edit `prompts/question-generation.md`, reset again.
 *
 * What it does NOT do:
 *
 * - **No Gemini calls.** It only clears `quiz_questions` and sets
 *   `questions_generated_at` back to null, which is what makes a book eligible
 *   for generation again. The questions are written the next time someone
 *   opens the book, so you spend quota only on books you actually look at.
 *   (`npm run backfill:questions` is the other direction: regenerate a batch
 *   right now, throttled.)
 * - **No re-fetching from Wikipedia.** `hydrated_at`, the plot text and the
 *   covers are left exactly as they are. Books stay hydrated.
 *
 * Drill history is untouched by design, but note that deleting a question
 * cascades to its `drill_results` rows -- the per-question log cannot outlive
 * the question it refers to. Box positions in `book_drill_states` survive.
 */
// Must stay first: loads .env.local before any module reads process.env.
import "@/lib/env-init";

import { count, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { books, quizQuestions } from "@/db/schema";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const promptVersion = argValue("--prompt-version");
  const bookArg = argValue("--book");
  const bookId = bookArg === undefined ? undefined : Number(bookArg);

  if (bookArg !== undefined && !Number.isInteger(bookId)) {
    console.error(`--book expects a numeric id, got "${bookArg}".`);
    process.exit(1);
  }

  const filter = bookId !== undefined
    ? eq(quizQuestions.bookId, bookId)
    : promptVersion
      ? eq(quizQuestions.promptVersion, promptVersion)
      : undefined;

  const doomed = await db
    .select({ bookId: quizQuestions.bookId })
    .from(quizQuestions)
    .where(filter);

  const affectedBooks = [...new Set(doomed.map((row) => row.bookId))];

  console.log(
    `${doomed.length} question(s) across ${affectedBooks.length} book(s)` +
      (promptVersion ? ` at prompt_version ${promptVersion}` : "") +
      (bookId !== undefined ? ` for book ${bookId}` : "") +
      (dryRun ? " [dry run — nothing deleted]" : ""),
  );

  if (dryRun) return;

  if (doomed.length > 0) {
    await db.delete(quizQuestions).where(filter);
  }

  // Clearing the timestamp is the part that actually re-opens the door:
  // generation refuses to run while questions_generated_at is set.
  if (affectedBooks.length > 0) {
    await db
      .update(books)
      .set({ questionsGeneratedAt: null })
      .where(inArray(books.id, affectedBooks));
  } else if (!promptVersion && bookId === undefined) {
    // No questions existed, but some books may still be marked as generated
    // (a book whose article was too thin gets the timestamp and no rows).
    await db
      .update(books)
      .set({ questionsGeneratedAt: null })
      .where(isNotNull(books.questionsGeneratedAt));
  }

  const remaining = await db.select({ value: count() }).from(quizQuestions);
  console.log(
    `done. ${remaining[0]?.value ?? 0} question(s) left in the table. ` +
      `Open a book in the app and it will generate again with the current prompt.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
