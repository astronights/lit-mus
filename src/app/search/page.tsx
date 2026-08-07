"use client";

import { useEffect, useState } from "react";

import { BookRow } from "@/components/book-row";
import { EmptyNote, ErrorNote, Loading, PageHeader } from "@/components/ui";
import type { BookSummary } from "@/lib/books";
import { useApi } from "@/lib/use-api";

/**
 * Tab 2 -- Search. Title/author over the seeded set only, which is why it is
 * fast and why every hit is guaranteed to hydrate cleanly when tapped.
 */
export default function SearchPage() {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);

  const { data, error, loading } = useApi<{ books: BookSummary[] }>(
    debounced.length >= 2 ? `/api/books?search=${encodeURIComponent(debounced)}` : null,
  );

  return (
    <>
      <PageHeader title="Search" subtitle="I just heard of this book — what is it?" />

      <input
        type="search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Title or author"
        autoComplete="off"
        // 16px minimum: anything smaller makes iOS Safari zoom on focus.
        className="mb-4 w-full rounded-xl border border-border bg-surface px-4 py-3 text-base outline-none placeholder:text-muted-foreground focus:border-accent"
        aria-label="Search books"
      />

      {loading ? <Loading /> : null}
      {error ? <ErrorNote message={error} /> : null}

      {debounced.length >= 2 && data && data.books.length === 0 && !loading ? (
        <EmptyNote>
          Nothing seeded matches “{debounced}”. Seeding more sources would widen this.
        </EmptyNote>
      ) : null}

      <ul className="space-y-2">
        {data?.books.map((book) => (
          <li key={book.id}>
            <BookRow book={book} />
          </li>
        ))}
      </ul>
    </>
  );
}
