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

  // Counted before anything is deleted, and reported separately: on a full
  // reset this is usually larger than `affectedBooks`, and the gap is the
  // books that produced no questions at all.
  const [marked] = await db
    .select({ value: count() })
    .from(books)
    .where(isNotNull(books.questionsGeneratedAt));

  console.log(
    `${doomed.length} question(s) across ${affectedBooks.length} book(s)` +
      (promptVersion ? ` at prompt_version ${promptVersion}` : "") +
      (bookId !== undefined ? ` for book ${bookId}` : "") +
      (dryRun ? " [dry run — nothing deleted]" : ""),
  );

  if (!promptVersion && bookId === undefined) {
    console.log(`${marked?.value ?? 0} book(s) marked as generated will be re-opened.`);
  }

  if (dryRun) return;

  if (doomed.length > 0) {
    await db.delete(quizQuestions).where(filter);
  }

  /*
   * Clearing the timestamp is the part that actually re-opens the door:
   * generation refuses to run while questions_generated_at is set.
   *
   * A full reset clears every timestamp, not just those of books that had rows
   * to delete. The two are not the same set, and the difference is invisible:
   * a book gets the timestamp and no rows whenever its article was too thin, or
   * whenever validation discarded everything the model returned. Those books are
   * precisely the ones a full reset is meant to reach -- they are the failures --
   * and keying the update off `affectedBooks` left them marked as done forever,
   * so they silently never regenerated however many times this was run.
   */
  const fullReset = !promptVersion && bookId === undefined;

  if (fullReset) {
    await db
      .update(books)
      .set({ questionsGeneratedAt: null })
      .where(isNotNull(books.questionsGeneratedAt));
  } else if (affectedBooks.length > 0) {
    await db
      .update(books)
      .set({ questionsGeneratedAt: null })
      .where(inArray(books.id, affectedBooks));
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
