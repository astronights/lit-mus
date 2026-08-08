import { and, asc, count, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookDrillStates, books, drillResults, quizQuestions } from "@/db/schema";
import { questionsForBooks, type BookQuestion } from "@/lib/books";
import type { CardUnavailable } from "@/lib/drill-status";
import { hydrateBook } from "@/lib/hydrate";
import { generateQuestionsForBook } from "@/lib/questions/generate";
import {
  BOX_INTERVAL_DAYS,
  MAX_BOX,
  composeSession,
  scheduleNext,
  type Candidate,
  type DrillOutcome,
} from "@/lib/leitner";

export type DrillCard = {
  bookId: number;
  title: string;
  author: string | null;
  coverUrl: string | null;
  box: number;
  questions: BookQuestion[];
};

/**
 * Pick the books for a session.
 *
 * **Drill no longer depends on what you have opened in Browse.** It used to
 * require a hydrated book with questions already generated, which made the
 * study loop a hostage to browsing habits. Now any seeded book is eligible and
 * the content is fetched when the card comes up (see `loadDrillCard`).
 *
 * Only two things exclude a book: you retired it by hand, or generation has
 * already run for it and produced nothing -- a Wikipedia article too thin to
 * ask about honestly. Without that second check a book with no possible
 * questions would be re-offered, re-fetched and re-skipped forever.
 */
export async function pickSessionBooks(
  userId: string,
  size = 12,
  exclude: number[] = [],
): Promise<number[]> {
  // Paging: the client asks for a couple of ids at a time and passes back what
  // it has already been given, so a session is not capped at one page and a
  // book cannot appear twice in it.
  const notAlreadyServed =
    exclude.length > 0 ? sql`${books.id} not in ${exclude}` : sql`true`;

  const hasQuestionsOrUntried = sql`(
    ${books.questionsGeneratedAt} is null
    or exists (select 1 from ${quizQuestions} q where q.book_id = ${books.id})
  )`;

  // Books already in rotation, oldest due first, and never-drilled books as a
  // random sample. Two bounded queries rather than one scan of the library:
  // most of the shelf has no drill state at all, so ordering the whole table by
  // due date would sort thousands of nulls to find a handful of rows.
  const [scheduled, fresh] = await Promise.all([
    db
      .select({ bookId: books.id, box: bookDrillStates.box, dueAt: bookDrillStates.dueAt })
      .from(bookDrillStates)
      .innerJoin(books, eq(books.id, bookDrillStates.bookId))
      .where(
        and(
          eq(bookDrillStates.userId, userId),
          eq(bookDrillStates.manuallyRetired, false),
          hasQuestionsOrUntried,
          notAlreadyServed,
        ),
      )
      .orderBy(asc(bookDrillStates.dueAt))
      .limit(200),
    db
      .select({ bookId: books.id })
      .from(books)
      .where(
        and(
          sql`not exists (
            select 1 from ${bookDrillStates} s
            where s.book_id = ${books.id} and s.user_id = ${userId}
          )`,
          hasQuestionsOrUntried,
          notAlreadyServed,
        ),
      )
      .orderBy(sql`random()`)
      .limit(60),
  ]);

  const candidates: Candidate[] = [
    ...scheduled.map((row) => ({ bookId: row.bookId, box: row.box, dueAt: row.dueAt })),
    ...fresh.map((row) => ({ bookId: row.bookId, box: null, dueAt: null })),
  ];

  return composeSession(candidates, { size });
}

export type DrillCardResult =
  | { card: DrillCard }
  | { card: null; reason: CardUnavailable; detail?: string };

/**
 * Fetch one card, doing whatever work the book still needs.
 *
 * This is where hydration and question generation happen, which is why it can
 * take a few seconds: a book nobody has opened needs Open Library, Wikidata and
 * Wikipedia, then a Gemini call. Every later appearance is a DB read.
 */
export async function loadDrillCard(userId: string, bookId: number): Promise<DrillCardResult> {
  const book = await db.query.books.findFirst({ where: eq(books.id, bookId) });
  if (!book) return { card: null, reason: "not_found" };

  if (!book.hydratedAt) {
    try {
      await hydrateBook(book);
    } catch {
      // Every source failed -- a network blip rather than a thin article. Leave
      // the book a cache miss so a later session retries it.
      return { card: null, reason: "unreachable" };
    }
  }

  if (!book.questionsGeneratedAt) {
    const outcome = await generateQuestionsForBook(bookId);

    if (outcome.status === "skipped" && outcome.reason === "not_configured") {
      return { card: null, reason: "generation_unavailable" };
    }
    if (outcome.status === "throttled") return { card: null, reason: "throttled" };
    // Not fatal, unlike "failed": Google was briefly overloaded, which says
    // nothing about the next book, so the session skips this one and carries on.
    if (outcome.status === "unavailable") return { card: null, reason: "model_busy" };
    if (outcome.status === "quota_exceeded") {
      return {
        card: null,
        reason: "quota_exceeded",
        detail: `Retry in about ${Math.ceil(outcome.retryAfterSeconds / 60)} minutes.`,
      };
    }

    // Generation *threw* -- a bad model name, an auth failure, a prompt file
    // missing from the bundle. Reporting this as "no questions" blamed the
    // book's Wikipedia article for a fault on our side, which is how twelve
    // failures in a row looked like twelve thin articles.
    if (outcome.status === "failed") {
      return { card: null, reason: "generation_failed", detail: outcome.reason };
    }
  }

  const [row] = await db
    .select({
      bookId: books.id,
      title: books.title,
      author: books.author,
      coverUrl: books.coverUrl,
      box: bookDrillStates.box,
    })
    .from(books)
    .leftJoin(
      bookDrillStates,
      and(eq(bookDrillStates.bookId, books.id), eq(bookDrillStates.userId, userId)),
    )
    .where(eq(books.id, bookId))
    .limit(1);

  if (!row) return { card: null, reason: "not_found" };

  const questions = (await questionsForBooks([bookId])).get(bookId) ?? [];
  // `questions_generated_at` is set either way, so a book whose article was too
  // thin is not offered again.
  if (questions.length === 0) return { card: null, reason: "no_questions" };

  return {
    card: {
      bookId: row.bookId,
      title: row.title,
      author: row.author,
      coverUrl: row.coverUrl,
      box: row.box ?? 1,
      questions,
    },
  };
}

export type CardResultInput = {
  bookId: number;
  /** One entry per answered question. Skipped questions are simply absent. */
  answers: Array<{ questionId: number; outcome: DrillOutcome }>;
};

export type CardResultOutcome = {
  box: number;
  dueAt: string;
  cleanPass: boolean;
  recorded: boolean;
};

/**
 * Record one finished card and reschedule the book.
 *
 * A card where everything was skipped writes nothing at all -- no DrillResult
 * rows, no box change, no due-date change. Skip is neutral by design, and the
 * queue simply re-serves the card later in the same session.
 */
export async function recordCardResult(
  userId: string,
  input: CardResultInput,
): Promise<CardResultOutcome> {
  const questionCount = await db
    .select({ value: count() })
    .from(quizQuestions)
    .where(eq(quizQuestions.bookId, input.bookId))
    .then((rows) => rows[0]?.value ?? 0);

  // Only accept answers to questions that really belong to this book, so a
  // crafted request cannot log results against someone else's card.
  const validIds = new Set(
    (
      await db
        .select({ id: quizQuestions.id })
        .from(quizQuestions)
        .where(
          and(
            eq(quizQuestions.bookId, input.bookId),
            inArray(
              quizQuestions.id,
              input.answers.length > 0 ? input.answers.map((a) => a.questionId) : [-1],
            ),
          ),
        )
    ).map((row) => row.id),
  );
  const answers = input.answers.filter((answer) => validIds.has(answer.questionId));

  const existing = await db.query.bookDrillStates.findFirst({
    where: and(eq(bookDrillStates.userId, userId), eq(bookDrillStates.bookId, input.bookId)),
  });

  const result = scheduleNext({
    box: existing?.box ?? 1,
    outcomes: answers.map((answer) => answer.outcome),
    questionCount,
  });

  if (!result.counted) {
    return {
      box: existing?.box ?? 1,
      dueAt: (existing?.dueAt ?? new Date()).toISOString(),
      cleanPass: false,
      recorded: false,
    };
  }

  const now = new Date();

  await db.insert(drillResults).values(
    answers.map((answer) => ({
      userId,
      bookId: input.bookId,
      questionId: answer.questionId,
      outcome: answer.outcome,
      answeredAt: now,
    })),
  );

  await db
    .insert(bookDrillStates)
    .values({
      userId,
      bookId: input.bookId,
      box: result.box,
      dueAt: result.dueAt,
      lastDrilledAt: now,
      cleanPasses: result.cleanPass ? 1 : 0,
      attempts: 1,
    })
    .onConflictDoUpdate({
      target: [bookDrillStates.userId, bookDrillStates.bookId],
      set: {
        box: result.box,
        dueAt: result.dueAt,
        lastDrilledAt: now,
        cleanPasses: sql`${bookDrillStates.cleanPasses} + ${result.cleanPass ? 1 : 0}`,
        attempts: sql`${bookDrillStates.attempts} + 1`,
      },
    });

  return {
    box: result.box,
    dueAt: result.dueAt.toISOString(),
    cleanPass: result.cleanPass,
    recorded: true,
  };
}

/** The "I've got this, stop showing me" escape hatch. Permanent, by choice. */
export async function retireBook(userId: string, bookId: number, retired = true): Promise<void> {
  await db
    .insert(bookDrillStates)
    .values({
      userId,
      bookId,
      box: MAX_BOX,
      dueAt: new Date(),
      manuallyRetired: retired,
    })
    .onConflictDoUpdate({
      target: [bookDrillStates.userId, bookDrillStates.bookId],
      set: { manuallyRetired: retired },
    });
}

export type ProgressSummary = {
  boxes: Array<{ box: number; count: number; intervalDays: number }>;
  dueToday: number;
  drilledBooks: number;
  retired: number;
  struggling: Array<{
    bookId: number;
    title: string;
    author: string | null;
    box: number;
    attempts: number;
    missed: number;
  }>;
};

/** Numbers behind the Progress tab (Section 5b, Tab 4). */
export async function getProgress(userId: string): Promise<ProgressSummary> {
  const now = new Date();

  const [boxRows, dueRows, retiredRows, strugglingRows] = await Promise.all([
    db
      .select({ box: bookDrillStates.box, count: count() })
      .from(bookDrillStates)
      .where(and(eq(bookDrillStates.userId, userId), eq(bookDrillStates.manuallyRetired, false)))
      .groupBy(bookDrillStates.box),
    db
      .select({ value: count() })
      .from(bookDrillStates)
      .where(
        and(
          eq(bookDrillStates.userId, userId),
          eq(bookDrillStates.manuallyRetired, false),
          lte(bookDrillStates.dueAt, now),
        ),
      ),
    db
      .select({ value: count() })
      .from(bookDrillStates)
      .where(and(eq(bookDrillStates.userId, userId), eq(bookDrillStates.manuallyRetired, true))),
    // Books stuck in the low boxes after several attempts. Sometimes a
    // knowledge gap, sometimes a badly generated question -- worth eyeballing.
    db
      .select({
        bookId: bookDrillStates.bookId,
        title: books.title,
        author: books.author,
        box: bookDrillStates.box,
        attempts: bookDrillStates.attempts,
        missed: sql<number>`count(*) filter (where ${drillResults.outcome} = 'missed')::int`,
      })
      .from(bookDrillStates)
      .innerJoin(books, eq(books.id, bookDrillStates.bookId))
      .leftJoin(
        drillResults,
        and(
          eq(drillResults.bookId, bookDrillStates.bookId),
          eq(drillResults.userId, bookDrillStates.userId),
        ),
      )
      .where(
        and(
          eq(bookDrillStates.userId, userId),
          eq(bookDrillStates.manuallyRetired, false),
          lte(bookDrillStates.box, 2),
          gt(bookDrillStates.attempts, 2),
        ),
      )
      .groupBy(bookDrillStates.bookId, books.title, books.author, bookDrillStates.box, bookDrillStates.attempts)
      .orderBy(desc(sql`count(*) filter (where ${drillResults.outcome} = 'missed')`))
      .limit(10),
  ]);

  const byBox = new Map(boxRows.map((row) => [row.box, row.count]));
  const boxes = [1, 2, 3, 4, 5].map((box) => ({
    box,
    count: byBox.get(box) ?? 0,
    intervalDays: BOX_INTERVAL_DAYS[box] ?? 0,
  }));

  return {
    boxes,
    dueToday: dueRows[0]?.value ?? 0,
    drilledBooks: boxRows.reduce((total, row) => total + row.count, 0),
    retired: retiredRows[0]?.value ?? 0,
    struggling: strugglingRows,
  };
}
