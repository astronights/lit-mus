/**
 * Maintenance script for the one-shot generation rule (Section 5a).
 *
 * Questions are generated once and never regenerated in the app. That is
 * deliberate, but it means a prompt improvement only reaches books hydrated
 * afterwards. This is the escape hatch: find questions written under an old
 * prompt version (or ones that failed validation), delete them, and let
 * generation run again with the current prompt.
 *
 *   npm run backfill:questions -- --prompt-version 2026-08-07.1
 *   npm run backfill:questions -- --pending-review
 *   npm run backfill:questions -- --pending-review --limit 20 --dry-run
 *
 * Throttled to stay inside the Gemini free tier -- this is exactly the "slow
 * background batch, not a single job" case the design doc warns about.
 */
// Must stay first: loads .env.local before any module reads process.env.
import "@/lib/env-init";

import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { books, quizQuestions } from "@/db/schema";
import { generateQuestionsForBook } from "@/lib/questions/generate";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const promptVersion = argValue("--prompt-version");
  const pendingOnly = process.argv.includes("--pending-review");
  const dryRun = process.argv.includes("--dry-run");
  const limit = Number(argValue("--limit") ?? 50);
  const delayMs = Number(argValue("--delay-ms") ?? 7_000);

  if (!promptVersion && !pendingOnly) {
    console.error("Pass --prompt-version <version> and/or --pending-review.");
    process.exit(1);
  }

  const versionFilter = promptVersion
    ? eq(quizQuestions.promptVersion, promptVersion)
    : undefined;
  const pendingFilter = pendingOnly ? eq(quizQuestions.pendingReview, true) : undefined;

  const stale = await db
    .select({ bookId: quizQuestions.bookId })
    .from(quizQuestions)
    .where(and(versionFilter, pendingFilter));

  const bookIds = [...new Set(stale.map((row) => row.bookId))].slice(0, limit);

  console.log(`${bookIds.length} book(s) to regenerate${dryRun ? " [dry run]" : ""}`);
  if (dryRun || bookIds.length === 0) return;

  for (const [index, bookId] of bookIds.entries()) {
    // Clearing both the rows and the timestamp is what makes the book eligible
    // again -- generation refuses to run while questions_generated_at is set.
    await db.delete(quizQuestions).where(eq(quizQuestions.bookId, bookId));
    await db.update(books).set({ questionsGeneratedAt: null }).where(eq(books.id, bookId));

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
