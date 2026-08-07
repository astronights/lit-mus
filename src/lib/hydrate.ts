import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { books, plotBlurbs } from "@/db/schema";
import { optional } from "@/lib/http";
import { properNounNames } from "@/lib/proper-nouns";
import { fetchOpenLibrary } from "@/lib/sources/open-library";
import { fetchWikidata } from "@/lib/sources/wikidata";
import {
  composeSourceDocument,
  fetchWikipediaPlot,
  searchWikipediaArticle,
  toShortBlurb,
} from "@/lib/sources/wikipedia";

export type BookRow = typeof books.$inferSelect;

export class HydrationFailedError extends Error {
  constructor() {
    super("Every source failed for this book");
    this.name = "HydrationFailedError";
  }
}

/**
 * Fetch everything external for one book and write it to Neon.
 *
 * Runs exactly once per book, ever: the caller only invokes this when
 * `hydrated_at` is null. Every source is optional -- a book with a cover and
 * no plot still renders, and marking it hydrated anyway is deliberate, since
 * re-fetching a thin article on every visit would just re-fail slowly.
 *
 * Call shape (Section 3): Open Library and Wikidata go out together, then the
 * Wikipedia extract, because the enwiki article title comes from Wikidata's
 * sitelinks. Worst case -- no sitelink, so we fall back to Wikipedia search --
 * is three sequential round trips, which still leaves plenty of headroom under
 * the 10s Hobby function limit.
 */
export async function hydrateBook(book: BookRow): Promise<BookRow> {
  const [openLibrary, wikidata] = await Promise.all([
    optional("open-library", () => fetchOpenLibrary(book.title, book.author)),
    book.wikidataId
      ? optional("wikidata", () => fetchWikidata(book.wikidataId!))
      : Promise.resolve(null),
  ]);

  const articleTitle =
    book.wikipediaTitle ??
    wikidata?.enwikiTitle ??
    (await optional("wikipedia-search", () => searchWikipediaArticle(book.title, book.author)));

  const wikipedia = articleTitle
    ? await optional("wikipedia", () => fetchWikipediaPlot(articleTitle))
    : null;

  const plotText = wikipedia?.plotText ?? "";
  // Lead + headings + plot. The model knows the reception and legacy of most
  // books already; what it needs from us is the frame and the story.
  const sourceDocument = composeSourceDocument(
    plotText,
    wikipedia?.leadText ?? "",
    wikipedia?.sectionHeadings ?? [],
  );

  // Wikidata P674 first; proper nouns from the plot when it has nothing.
  const characterNames =
    wikidata?.characters && wikidata.characters.length > 0
      ? wikidata.characters
      : properNounNames(plotText);

  // A thin Wikipedia article is a permanent fact about the book, and marking
  // it hydrated anyway is right: re-fetching on every visit would just re-fail
  // slowly. *Every* source failing is a different thing -- almost always a
  // network blip -- so that stays a cache miss and gets retried next time.
  const gotSomething =
    Boolean(sourceDocument) ||
    Boolean(openLibrary?.coverUrl) ||
    Boolean(openLibrary?.openLibraryId) ||
    characterNames.length > 0;

  if (!gotSomething) throw new HydrationFailedError();

  const now = new Date();

  const [updated] = await db
    .update(books)
    .set({
      coverUrl: openLibrary?.coverUrl ?? book.coverUrl,
      openLibraryId: openLibrary?.openLibraryId ?? book.openLibraryId,
      firstPublishYear: openLibrary?.firstPublishYear ?? book.firstPublishYear,
      wikipediaTitle: wikipedia?.articleTitle ?? book.wikipediaTitle,
      characters: characterNames.length > 0 ? characterNames.slice(0, 20) : book.characters,
      hydratedAt: now,
    })
    .where(eq(books.id, book.id))
    .returning();

  if (sourceDocument) {
    await db
      .insert(plotBlurbs)
      .values({
        bookId: book.id,
        // The card blurb stays plot-only; the stored extract is the wider
        // document, since that is what generation reads.
        shortBlurb: toShortBlurb(plotText || wikipedia?.leadText || ""),
        sourceExtract: sourceDocument,
        sourceUrl: wikipedia?.articleUrl ?? null,
      })
      .onConflictDoUpdate({
        target: plotBlurbs.bookId,
        set: {
          shortBlurb: sql`excluded.short_blurb`,
          sourceExtract: sql`excluded.source_extract`,
          sourceUrl: sql`excluded.source_url`,
        },
      });
  }

  return updated ?? { ...book, hydratedAt: now };
}
