/**
 * Maintenance script for the one-shot generation rule (Section 5a).
 *
 * Questions are generated once and never regenerated in the app. That is
 * deliberate, but it means a prompt improvement only reaches books hydrated
 * afterwards. This is the escape hatch: find questions written under an old
 * prompt version (or ones that failed validation), delete them, and let
 * generation run again with the current prompt.
 *
 *   npm run backfill:questions -- --prompt-version 2026-08-07.1 --rehydrate
 *   npm run backfill:questions -- --prompt-version 2026-08-07.1 --limit 20 --dry-run
 *
 * `--rehydrate` re-fetches the Wikipedia article first. Needed when the stored
 * text itself has changed shape -- books hydrated before prompt 2026-08-07.2
 * hold only the Plot section, and the current prompt expects the wider
 * "about the work" document as well.
 *
 * Throttled to stay inside the Gemini free tier -- this is exactly the "slow
 * background batch, not a single job" case the design doc warns about.
 */
// Must stay first: loads .env.local before any module reads process.env.
import "@/lib/env-init";

import { eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { books, quizQuestions } from "@/db/schema";
import { hydrateBook } from "@/lib/hydrate";
import { generateQuestionsForBook } from "@/lib/questions/generate";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const promptVersion = argValue("--prompt-version");
  const dryRun = process.argv.includes("--dry-run");
  const rehydrate = process.argv.includes("--rehydrate");
  const limit = Number(argValue("--limit") ?? 50);
  const delayMs = Number(argValue("--delay-ms") ?? 7_000);

  if (!promptVersion) {
    console.error("Pass --prompt-version <version>.");
    process.exit(1);
  }

  const stale = await db
    .select({ bookId: quizQuestions.bookId })
    .from(quizQuestions)
    .where(eq(quizQuestions.promptVersion, promptVersion));

  const bookIds = [...new Set(stale.map((row) => row.bookId))].slice(0, limit);

  console.log(`${bookIds.length} book(s) to regenerate${dryRun ? " [dry run]" : ""}`);
  if (dryRun || bookIds.length === 0) return;

  for (const [index, bookId] of bookIds.entries()) {
    // Clearing both the rows and the timestamp is what makes the book eligible
    // again -- generation refuses to run while questions_generated_at is set.
    await db.delete(quizQuestions).where(eq(quizQuestions.bookId, bookId));
    await db.update(books).set({ questionsGeneratedAt: null }).where(eq(books.id, bookId));

    if (rehydrate) {
      const book = await db.query.books.findFirst({ where: eq(books.id, bookId) });
      // hydrateBook overwrites the stored extract in place, so there is no need
      // to clear hydrated_at and risk leaving the book empty if the fetch fails.
      if (book) await hydrateBook(book).catch((error) => console.warn(`  rehydrate failed: ${error}`));
    }

    const outcome = await generateQuestionsForBook(bookId);
    console.log(`[${index + 1}/${bookIds.length}] book ${bookId}: ${outcome.status}`);

    if (index < bookIds.length - 1) await sleep(delayMs);
  }

  const remaining = await db
    .select({ id: books.id })
    .from(books)
    .where(isNotNull(books.hydratedAt));
  console.log(`done. ${remaining.length} hydrated book(s) in total.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
