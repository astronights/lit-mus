/**
 * Throw away everything fetched and force a fresh pull from scratch.
 *
 *   npm run hydration:reset                  # shows what would go, changes nothing
 *   npm run hydration:reset -- --yes         # actually do it
 *   npm run hydration:reset -- --book 42 --yes
 *
 * Destructive, so it is a dry run unless you pass --yes.
 *
 * What it clears, per book:
 *   - `hydrated_at`            -> the next visit re-fetches Open Library,
 *                                 Wikidata and Wikipedia from scratch
 *   - `questions_generated_at` -> and then regenerates the questions
 *   - the `plot_blurbs` row, the character array, the cover, the Open Library
 *     id and the resolved Wikipedia title
 *   - every `quiz_questions` row
 *
 * What it keeps:
 *   - the seeded books themselves: title, author, wikidata_id, categories.
 *     Seeding is the cheap part and there is no reason to redo it.
 *   - accounts and sessions
 *   - `book_drill_states`, so box positions and due dates survive
 *
 * Note that deleting a question cascades to its `drill_results` rows: the
 * per-question log cannot outlive the question it refers to. Box positions are
 * unaffected, so a book you had worked up to box 4 stays in box 4.
 *
 * Nothing is re-fetched here. Books re-hydrate lazily when someone opens them,
 * which is the whole point of the cache-miss design -- you pay for the books
 * you actually look at.
 */
// Must stay first: loads .env.local before any module reads process.env.
import "@/lib/env-init";

import { count, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { books, plotBlurbs, quizQuestions } from "@/db/schema";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const confirmed = process.argv.includes("--yes");
  const bookArg = argValue("--book");
  const bookId = bookArg === undefined ? undefined : Number(bookArg);

  if (bookArg !== undefined && !Number.isInteger(bookId)) {
    console.error(`--book expects a numeric id, got "${bookArg}".`);
    process.exit(1);
  }

  const bookFilter = bookId !== undefined ? eq(books.id, bookId) : isNotNull(books.hydratedAt);

  const [hydrated, blurbs, questions] = await Promise.all([
    db.select({ value: count() }).from(books).where(bookFilter),
    db.select({ value: count() }).from(plotBlurbs),
    db.select({ value: count() }).from(quizQuestions),
  ]);

  console.log(
    `${hydrated[0]?.value ?? 0} hydrated book(s), ` +
      `${blurbs[0]?.value ?? 0} stored article(s), ` +
      `${questions[0]?.value ?? 0} question(s)` +
      (bookId !== undefined ? ` (scoped to book ${bookId})` : ""),
  );

  if (!confirmed) {
    console.log("\nDry run. Re-run with --yes to clear all of the above.");
    console.log("Seeded books, categories, accounts and drill boxes are kept either way.");
    return;
  }

  if (bookId !== undefined) {
    await db.delete(quizQuestions).where(eq(quizQuestions.bookId, bookId));
    await db.delete(plotBlurbs).where(eq(plotBlurbs.bookId, bookId));
  } else {
    await db.delete(quizQuestions);
    await db.delete(plotBlurbs);
  }

  await db
    .update(books)
    .set({
      hydratedAt: null,
      questionsGeneratedAt: null,
      characters: null,
      coverUrl: null,
      openLibraryId: null,
      // Cleared too: a wrong article match is one of the things a fresh pull
      // is meant to fix, and keeping it would pin the book to that article.
      wikipediaTitle: null,
    })
    .where(bookFilter);

  console.log(
    "done. Every affected book is a cache miss again — open one in the app and it " +
      "re-fetches Open Library, Wikidata and Wikipedia, then generates questions.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
