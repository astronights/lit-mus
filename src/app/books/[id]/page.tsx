"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { Chip, ErrorNote, Loading, PageHeader } from "@/components/ui";
import type { BookDetail } from "@/lib/books";
import { useApi } from "@/lib/use-api";

/**
 * Book Detail -- a pushed screen, not a tab.
 *
 * The first open of a book triggers hydration server-side, so this request can
 * take a few seconds.
 *
 * Questions are deliberately absent from this screen. They belong to Drill --
 * reading them here spoils the riddle, which is the one thing the drill card is
 * built around. Generation therefore happens in Drill too (see
 * /api/drill/card/[bookId]), not from this page.
 */
/**
 * Book Detail is reached from Browse *and* from Search, so the hard-coded
 * `/search` href this replaces sent half the people who used it to the wrong
 * tab. History gets you back where you actually came from; the push to Browse
 * covers a cold arrival -- a shared link, or the PWA restoring this page --
 * where there is no history entry to pop.
 */
function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
      className="text-sm opacity-70 hover:opacity-100"
    >
      ← Back
    </button>
  );
}

export default function BookDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const { data, error, loading, reload } = useApi<{ book: BookDetail }>(
    id ? `/api/books/${id}` : null,
  );

  // The back control renders in every state. It used to live inside the loaded
  // branch, so a book that failed to fetch left you on a dead screen with no
  // way out but the tab bar.
  if (loading) {
    return (
      <>
        <BackButton />
        <Loading label="Fetching this book…" />
      </>
    );
  }

  if (error) {
    return (
      <>
        <BackButton />
        <div className="mt-3 space-y-3">
          <ErrorNote message={error} />
          <button
            type="button"
            onClick={reload}
            className="ink-button w-full bg-surface px-4 py-2.5 font-display text-lg"
          >
            Try again
          </button>
        </div>
      </>
    );
  }

  if (!data) return null;

  const book = data.book;

  return (
    <article className="pb-4">
      <BackButton />

      <div className="mt-3 flex gap-4">
        {book.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={book.coverUrl}
            alt={`Cover of ${book.title}`}
            className="h-36 w-24 shrink-0 rounded-lg border-2 border-ink object-cover shadow-[3px_3px_0_var(--ink)]"
          />
        ) : null}
        <div className="min-w-0">
          <PageHeader
            title={book.title}
            subtitle={[book.author, book.firstPublishYear].filter(Boolean).join(" · ")}
          />
        </div>
      </div>

      {book.categories.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {book.categories.map((category) => (
            <Chip key={category.id} href={`/browse/${category.slug}`}>
              {category.name}
            </Chip>
          ))}
        </div>
      ) : null}

      {book.blurb ? (
        <section className="mt-6">
          <h2 className="mb-2 font-display text-base uppercase tracking-wide opacity-70">Plot</h2>
          <p className="text-[15px] leading-relaxed">{book.blurb.shortBlurb}</p>
          {/* Per-card CC BY-SA attribution; the licence note is in the footer. */}
          {book.blurb.sourceUrl ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Plot summary adapted from{" "}
              <a
                className="underline underline-offset-2"
                href={book.blurb.sourceUrl}
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
        <p className="mt-6 text-sm text-muted-foreground">
          No plot summary found for this one — its Wikipedia article is probably thin.
        </p>
      )}

      {book.characters.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 font-display text-base uppercase tracking-wide opacity-70">
            Key characters
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {book.characters.map((character) => (
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
