import { eq } from "drizzle-orm";
import { headers } from "next/headers";

import { db } from "@/db";
import { books } from "@/db/schema";
import { Chip, ErrorNote } from "@/components/ui";
import { getBookDetail } from "@/lib/books";
import { HydrationFailedError, hydrateBook } from "@/lib/hydrate";
import { clientIp, rateLimit } from "@/lib/rate-limit";

import { BackButton } from "./back-button";

// Reads the database on every request; never prerendered.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A first open fetches Open Library, Wikidata and Wikipedia.
export const maxDuration = 30;

/**
 * Book Detail -- a pushed screen, not a tab.
 *
 * **Rendered on the server.** It used to be a client component that fetched
 * `/api/books/:id` after mounting, which made opening a book two sequential
 * round trips from the browser: one for the page, then one for its data, with
 * a "Fetching this book…" flash in between. The data is now already in the
 * HTML, so there is one round trip and no flash.
 *
 * Questions are deliberately absent. They belong to Drill -- reading them here
 * spoils the riddle, which is the one thing the drill card is built around.
 */
export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return <NotFound />;

  const book = await db.query.books.findFirst({ where: eq(books.id, id) });
  if (!book) return <NotFound />;

  if (!book.hydratedAt) {
    // Only cache misses are rate limited; ordinary re-reads stay unthrottled.
    const limiter = await rateLimit(`hydrate:${clientIp(await headers())}`, 20, 60);
    if (!limiter.ok) {
      return <Problem message="Too many new books at once. Give it a minute." />;
    }

    try {
      await hydrateBook(book);
    } catch (error) {
      if (error instanceof HydrationFailedError) {
        return <Problem message="Couldn't reach the book sources. Try again in a moment." />;
      }
      throw error;
    }
  }

  const detail = await getBookDetail(id);
  if (!detail) return <NotFound />;

  return (
    <article className="pb-4">
      <BackButton />

      <div className="mt-3 flex gap-4">
        {detail.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={detail.coverUrl}
            alt={`Cover of ${detail.title}`}
            className="h-36 w-24 shrink-0 rounded-lg border-2 border-ink object-cover shadow-[3px_3px_0_var(--ink-shadow)]"
          />
        ) : null}
        <header className="min-w-0">
          <h1 className="font-display text-3xl leading-tight">{detail.title}</h1>
          <p className="mt-1 text-sm opacity-70">
            {[detail.author, detail.firstPublishYear].filter(Boolean).join(" · ")}
          </p>
        </header>
      </div>

      {detail.categories.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {detail.categories.map((category) => (
            <Chip key={category.id} href={`/browse/${category.slug}`}>
              {category.name}
            </Chip>
          ))}
        </div>
      ) : null}

      {detail.blurb ? (
        <section className="mt-6">
          <h2 className="mb-2 font-display text-base uppercase tracking-wide opacity-70">Plot</h2>
          <p className="text-[15px] leading-relaxed">{detail.blurb.shortBlurb}</p>
          {/* Per-card CC BY-SA attribution; the site-wide note is on Progress. */}
          {detail.blurb.sourceUrl ? (
            <p className="mt-2 text-xs opacity-70">
              Plot summary adapted from{" "}
              <a
                className="underline underline-offset-2"
                href={detail.blurb.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Wikipedia
              </a>
              , CC BY-SA.
            </p>
          ) : null}
        </section>
      ) : (
        <p className="mt-6 text-sm opacity-70">
          No plot summary for this one — its Wikipedia article is probably thin.
        </p>
      )}

      {detail.characters.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 font-display text-base uppercase tracking-wide opacity-70">
            Key characters
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {detail.characters.map((character) => (
              <li key={character}>
                <Chip>{character}</Chip>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

function NotFound() {
  return <Problem message="No such book." />;
}

function Problem({ message }: { message: string }) {
  return (
    <>
      <BackButton />
      <div className="mt-3">
        <ErrorNote message={message} />
      </div>
    </>
  );
}
