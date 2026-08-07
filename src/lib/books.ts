import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookCategories, books, categories, characters, plotBlurbs, quizQuestions } from "@/db/schema";

export type BookSummary = {
  id: number;
  title: string;
  author: string | null;
  firstPublishYear: number | null;
  coverUrl: string | null;
  /** Coverage marker in Browse: has anyone opened this book yet? */
  hydrated: boolean;
};

export type BookQuestion = {
  id: number;
  type: "title_riddle" | "detail";
  questionText: string;
  answer: string;
  reported: boolean;
};

export type BookDetail = BookSummary & {
  categories: Array<{ id: number; slug: string; name: string }>;
  blurb: { shortBlurb: string; sourceUrl: string | null } | null;
  characters: Array<{ name: string; role: string | null }>;
  questions: BookQuestion[];
  /** Null while the background generation job has not finished. */
  questionsGeneratedAt: Date | null;
};

const summaryColumns = {
  id: books.id,
  title: books.title,
  author: books.author,
  firstPublishYear: books.firstPublishYear,
  coverUrl: books.coverUrl,
  hydratedAt: books.hydratedAt,
};

function toSummary(row: {
  id: number;
  title: string;
  author: string | null;
  firstPublishYear: number | null;
  coverUrl: string | null;
  hydratedAt: Date | null;
}): BookSummary {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    firstPublishYear: row.firstPublishYear,
    coverUrl: row.coverUrl,
    hydrated: row.hydratedAt !== null,
  };
}

/**
 * Search over the seeded set only -- fast, and every hit is guaranteed to
 * hydrate cleanly when tapped (Section 5b, Tab 2).
 */
export async function searchBooks(query: string, limit = 40): Promise<BookSummary[]> {
  const term = `%${query.trim()}%`;
  const rows = await db
    .select(summaryColumns)
    .from(books)
    .where(or(ilike(books.title, term), ilike(books.author, term)))
    // Books someone has already opened first: they render instantly and are
    // the more likely target of a repeat search.
    .orderBy(desc(isNotNull(books.hydratedAt)), asc(books.title))
    .limit(limit);

  return rows.map(toSummary);
}

export async function listBooks(limit = 50, offset = 0): Promise<BookSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(books)
    .orderBy(asc(books.title))
    .limit(limit)
    .offset(offset);
  return rows.map(toSummary);
}

export async function listCategoryBooks(
  slug: string,
  limit = 200,
  offset = 0,
): Promise<BookSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(books)
    .innerJoin(bookCategories, eq(bookCategories.bookId, books.id))
    .innerJoin(categories, eq(categories.id, bookCategories.categoryId))
    .where(eq(categories.slug, slug))
    .orderBy(asc(books.title))
    .limit(limit)
    .offset(offset);
  return rows.map(toSummary);
}

/**
 * Everything the Book Detail screen needs.
 *
 * Questions flagged `pending_review` are excluded: they failed the verbatim
 * answer check, and a wrong answer you memorise is worse than no answer at
 * all. The rows stay in the table for the maintenance script.
 */
export async function getBookDetail(id: number): Promise<BookDetail | null> {
  const book = await db.query.books.findFirst({ where: eq(books.id, id) });
  if (!book) return null;

  const [categoryRows, blurb, characterRows, questionRows] = await Promise.all([
    db
      .select({ id: categories.id, slug: categories.slug, name: categories.name })
      .from(categories)
      .innerJoin(bookCategories, eq(bookCategories.categoryId, categories.id))
      .where(eq(bookCategories.bookId, id))
      .orderBy(asc(categories.name)),
    db.query.plotBlurbs.findFirst({ where: eq(plotBlurbs.bookId, id) }),
    db
      .select({ name: characters.name, role: characters.role })
      .from(characters)
      .where(eq(characters.bookId, id))
      .orderBy(asc(characters.id)),
    db
      .select({
        id: quizQuestions.id,
        type: quizQuestions.type,
        questionText: quizQuestions.questionText,
        answer: quizQuestions.answer,
        reported: quizQuestions.reported,
      })
      .from(quizQuestions)
      .where(and(eq(quizQuestions.bookId, id), eq(quizQuestions.pendingReview, false)))
      // Riddle first: it is the question the card is built around.
      .orderBy(desc(eq(quizQuestions.type, "title_riddle")), asc(quizQuestions.id)),
  ]);

  return {
    ...toSummary(book),
    categories: categoryRows,
    blurb: blurb ? { shortBlurb: blurb.shortBlurb, sourceUrl: blurb.sourceUrl } : null,
    characters: characterRows,
    questions: questionRows,
    questionsGeneratedAt: book.questionsGeneratedAt,
  };
}

/** Questions for a set of books, for building a drill session in one query. */
export async function questionsForBooks(
  bookIds: number[],
): Promise<Map<number, BookQuestion[]>> {
  const result = new Map<number, BookQuestion[]>();
  if (bookIds.length === 0) return result;

  const rows = await db
    .select({
      id: quizQuestions.id,
      bookId: quizQuestions.bookId,
      type: quizQuestions.type,
      questionText: quizQuestions.questionText,
      answer: quizQuestions.answer,
      reported: quizQuestions.reported,
    })
    .from(quizQuestions)
    .where(
      and(
        inArray(quizQuestions.bookId, bookIds),
        eq(quizQuestions.pendingReview, false),
        eq(quizQuestions.reported, false),
      ),
    )
    .orderBy(desc(eq(quizQuestions.type, "title_riddle")), asc(quizQuestions.id));

  for (const row of rows) {
    const list = result.get(row.bookId) ?? [];
    list.push(row);
    result.set(row.bookId, list);
  }
  return result;
}

export async function listCategories() {
  return db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      type: categories.type,
      total: sql<number>`count(${bookCategories.bookId})::int`,
      hydrated: sql<number>`count(${books.hydratedAt})::int`,
    })
    .from(categories)
    .leftJoin(bookCategories, eq(bookCategories.categoryId, categories.id))
    .leftJoin(books, eq(books.id, bookCategories.bookId))
    .groupBy(categories.id)
    .orderBy(asc(categories.name));
}
