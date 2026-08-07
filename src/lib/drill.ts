import { and, count, desc, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookDrillStates, books, drillResults, quizQuestions } from "@/db/schema";
import { questionsForBooks, type BookQuestion } from "@/lib/books";
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
 * Build a drill session for a user.
 *
 * Only hydrated books with at least one displayable question are eligible --
 * a card with nothing to ask is not a card. Manually retired books are
 * excluded permanently; box 5 books are not, they just come round slowly.
 */
export async function buildSession(userId: string, size = 12): Promise<DrillCard[]> {
  const rows = await db
    .select({
      bookId: books.id,
      title: books.title,
      author: books.author,
      coverUrl: books.coverUrl,
      box: bookDrillStates.box,
      dueAt: bookDrillStates.dueAt,
      retired: bookDrillStates.manuallyRetired,
    })
    .from(books)
    .leftJoin(
      bookDrillStates,
      and(eq(bookDrillStates.bookId, books.id), eq(bookDrillStates.userId, userId)),
    )
    .innerJoin(
      quizQuestions,
      and(eq(quizQuestions.bookId, books.id), eq(quizQuestions.pendingReview, false)),
    )
    .where(isNotNull(books.hydratedAt))
    .groupBy(
      books.id,
      bookDrillStates.box,
      bookDrillStates.dueAt,
      bookDrillStates.manuallyRetired,
    )
    // Cap the candidate pool: composition only needs enough to fill a session
    // several times over, and the alternative is pulling the whole library.
    .limit(500);

  const candidates: Candidate[] = rows
    .filter((row) => !row.retired)
    .map((row) => ({ bookId: row.bookId, box: row.box, dueAt: row.dueAt }));

  const orderedIds = composeSession(candidates, { size });
  if (orderedIds.length === 0) return [];

  const questions = await questionsForBooks(orderedIds);
  const byId = new Map(rows.map((row) => [row.bookId, row]));

  return orderedIds
    .map((bookId) => {
      const row = byId.get(bookId)!;
      return {
        bookId,
        title: row.title,
        author: row.author,
        coverUrl: row.coverUrl,
        box: row.box ?? 1,
        questions: questions.get(bookId) ?? [],
      };
    })
    // A book whose only questions were reported can fall through to empty.
    .filter((card) => card.questions.length > 0);
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
    .where(and(eq(quizQuestions.bookId, input.bookId), eq(quizQuestions.pendingReview, false)))
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
  categories: Array<{ slug: string; name: string; total: number; hydrated: number }>;
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
export async function getProgress(userId: string): Promise<Omit<ProgressSummary, "categories">> {
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
