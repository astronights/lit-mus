import { inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookCategories, books, categories } from "@/db/schema";
import { dedupe, fetchSource, type SeedRow } from "@/lib/seed-rows";
import { enabledSources, type SeedSource } from "@/lib/seed-sources";

/**
 * The seed job (Section 4a).
 *
 * Idempotent by construction: books upsert on `wikidata_id`, categories upsert
 * on `slug`, and the join rows are insert-or-ignore. Re-running only ever adds
 * -- an already-seeded book is untouched, and a book that turns up in a second
 * source just gains a category tag.
 *
 * Not in the request path: run it as `npm run seed` or via the cron route.
 */

export type SourceReport = {
  sourceId: string;
  fetched: number;
  inserted: number;
  linked: number;
  skipped: number;
  error?: string;
};

export async function runSeed({
  sources = enabledSources(),
  dryRun = false,
  onProgress,
}: {
  sources?: SeedSource[];
  dryRun?: boolean;
  onProgress?: (message: string) => void;
} = {}): Promise<SourceReport[]> {
  const log = onProgress ?? (() => {});
  const reports: SourceReport[] = [];

  for (const source of sources) {
    const report: SourceReport = {
      sourceId: source.id,
      fetched: 0,
      inserted: 0,
      linked: 0,
      skipped: 0,
    };

    try {
      log(`[seed] ${source.id}: fetching (${source.kind}, expecting ${source.expected})`);
      const rows = dedupe(await fetchSource(source));
      report.fetched = rows.length;
      log(`[seed] ${source.id}: ${rows.length} rows`);

      if (dryRun) {
        reports.push(report);
        continue;
      }

      const categoryId = await upsertCategory(source);
      const { bookIds, inserted } = await upsertBooks(rows);
      report.inserted = inserted;
      report.skipped = rows.length - bookIds.length;
      report.linked = await linkCategory(bookIds, categoryId);

      log(
        `[seed] ${source.id}: +${report.inserted} new books, +${report.linked} category links`,
      );
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error);
      // One bad source must not abort the run -- the others are still useful,
      // and the job is safe to re-run once the query is fixed.
      log(`[seed] ${source.id}: FAILED -- ${report.error}`);
    }

    reports.push(report);
  }

  return reports;
}

async function upsertCategory(source: SeedSource): Promise<number> {
  const [row] = await db
    .insert(categories)
    .values({
      slug: source.id,
      name: source.name,
      type: source.type,
      seedSource: source.id,
    })
    .onConflictDoUpdate({
      target: categories.slug,
      set: { name: source.name, type: source.type },
    })
    .returning({ id: categories.id });

  return row!.id;
}

/** Rows per statement. Keeps the generated SQL well inside Neon's limits. */
const CHUNK = 200;

function chunked<T>(items: T[], size = CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Insert what's new and resolve ids for the rest, in batches.
 *
 * Batching matters here and nowhere else in the app: the Neon HTTP driver
 * makes every statement a round trip, and a per-book loop over ~2,000 titles
 * would be thousands of them.
 */
async function upsertBooks(rows: SeedRow[]): Promise<{ bookIds: number[]; inserted: number }> {
  const withQid = rows.filter((row) => row.wikidataId);
  const withoutQid = rows.filter((row) => !row.wikidataId);

  const bookIds: number[] = [];
  let inserted = 0;

  /* --- Wikidata-backed rows: upsert on wikidata_id ------------------------ */
  for (const chunk of chunked(withQid)) {
    const created = await db
      .insert(books)
      .values(
        chunk.map((row) => ({
          title: row.title,
          author: row.author,
          firstPublishYear: row.year,
          wikidataId: row.wikidataId,
        })),
      )
      // Existing rows are left completely alone: a hydrated book's data came
      // from Open Library and beats anything the seed knows.
      .onConflictDoNothing({ target: books.wikidataId })
      .returning({ id: books.id });
    inserted += created.length;

    const resolved = await db
      .select({ id: books.id })
      .from(books)
      .where(inArray(books.wikidataId, chunk.map((row) => row.wikidataId!)));
    bookIds.push(...resolved.map((row) => row.id));
  }

  /* --- File rows: no QID, so match on title + author ---------------------- */
  for (const chunk of chunked(withoutQid)) {
    const existing = await db
      .select({ id: books.id, title: books.title, author: books.author })
      .from(books)
      .where(inArray(sql`lower(${books.title})`, chunk.map((row) => row.title.toLowerCase())));

    const byKey = new Map(existing.map((row) => [titleAuthorKey(row.title, row.author), row.id]));

    const missing = chunk.filter((row) => !byKey.has(titleAuthorKey(row.title, row.author)));
    for (const row of chunk) {
      const id = byKey.get(titleAuthorKey(row.title, row.author));
      if (id !== undefined) bookIds.push(id);
    }

    if (missing.length > 0) {
      const created = await db
        .insert(books)
        .values(
          missing.map((row) => ({
            title: row.title,
            author: row.author,
            firstPublishYear: row.year,
          })),
        )
        .returning({ id: books.id });
      inserted += created.length;
      bookIds.push(...created.map((row) => row.id));
    }
  }

  return { bookIds, inserted };
}

function titleAuthorKey(title: string, author: string | null): string {
  return `${title.toLowerCase().trim()}|${(author ?? "").toLowerCase().trim()}`;
}

/** Tag every book with the source's category. Returns how many tags were new. */
async function linkCategory(bookIds: number[], categoryId: number): Promise<number> {
  let linked = 0;
  for (const chunk of chunked(bookIds)) {
    const created = await db
      .insert(bookCategories)
      .values(chunk.map((bookId) => ({ bookId, categoryId })))
      .onConflictDoNothing()
      .returning({ bookId: bookCategories.bookId });
    linked += created.length;
  }
  return linked;
}
