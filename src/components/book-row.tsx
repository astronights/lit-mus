import Link from "next/link";

import type { BookSummary } from "@/lib/books";
import { shelfColour } from "@/lib/shelf";

/**
 * Shared row format for Browse and Search results.
 *
 * Each row is tinted like a book spine, so a category list reads as a shelf.
 * The cover art sits on top of the tint rather than replacing it -- covers are
 * the one piece of real photography here and they stay exactly as they were.
 */
export function BookRow({ book }: { book: BookSummary }) {
  return (
    <Link
      href={`/books/${book.id}`}
      data-shelf={shelfColour(book.id)}
      className="ink-card ink-button flex items-center gap-3 px-3 py-2.5"
    >
      <Cover book={book} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[17px] leading-tight">{book.title}</span>
        <span className="block truncate text-[13px] opacity-70">
          {book.author ?? "Unknown author"}
          {book.firstPublishYear ? ` · ${book.firstPublishYear}` : ""}
        </span>
      </span>
      {/*
        Coverage marker (Section 5b): the same book shows up in several category
        lists, and a mark for "already opened" is what makes a list readable at
        a glance. An ink tick rather than a dot, to sit with the drawn style.
      */}
      {book.hydrated ? (
        <span
          className="shrink-0 text-lg leading-none"
          title="Already opened"
          aria-label="Already opened"
        >
          ✓
        </span>
      ) : null}
    </Link>
  );
}

function Cover({ book }: { book: BookSummary }) {
  if (!book.coverUrl) {
    return (
      <span
        aria-hidden
        className="flex h-14 w-10 shrink-0 items-center justify-center rounded border-2 border-ink bg-surface font-display text-lg"
      >
        {book.title.slice(0, 1)}
      </span>
    );
  }

  return (
    // Plain <img>: covers come straight from Open Library at a fixed small
    // size, so next/image's optimiser would add a hop for no benefit.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={book.coverUrl}
      alt=""
      loading="lazy"
      className="h-14 w-10 shrink-0 rounded border-2 border-ink object-cover"
    />
  );
}
