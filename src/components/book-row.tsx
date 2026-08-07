import Link from "next/link";

import type { BookSummary } from "@/lib/books";

/** Shared row format for Browse and Search results. */
export function BookRow({ book }: { book: BookSummary }) {
  return (
    <Link
      href={`/books/${book.id}`}
      className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 transition-colors hover:bg-surface-muted"
    >
      <Cover book={book} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[15px] font-semibold">{book.title}</span>
        <span className="block truncate text-[13px] text-muted-foreground">
          {book.author ?? "Unknown author"}
          {book.firstPublishYear ? ` · ${book.firstPublishYear}` : ""}
        </span>
      </span>
      {/*
        Coverage marker (Section 5b): the same book shows up in several
        category lists, and a dot for "already opened" is what makes a list
        readable at a glance.
      */}
      {book.hydrated ? (
        <span
          className="size-2 shrink-0 rounded-full bg-accent"
          title="Already opened"
          aria-label="Already opened"
        />
      ) : null}
    </Link>
  );
}

function Cover({ book }: { book: BookSummary }) {
  if (!book.coverUrl) {
    return (
      <span
        aria-hidden
        className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-surface-muted font-display text-sm text-muted-foreground"
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
      className="h-14 w-10 shrink-0 rounded object-cover"
    />
  );
}
