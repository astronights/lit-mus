"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { BookRow } from "@/components/book-row";
import { EmptyNote, ErrorNote, Loading, PageHeader } from "@/components/ui";
import type { BookSummary } from "@/lib/books";
import { useApi } from "@/lib/use-api";

/** Books in one category. Same row format as Search. */
export default function CategoryPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;

  const { data, error, loading } = useApi<{ books: BookSummary[] }>(
    slug ? `/api/categories/${encodeURIComponent(slug)}/books` : null,
  );

  const opened = data?.books.filter((book) => book.hydrated).length ?? 0;

  return (
    <>
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← Browse
      </Link>
      <PageHeader
        title={titleFromSlug(slug)}
        subtitle={data ? `${opened} of ${data.books.length} opened` : undefined}
      />

      {loading ? <Loading /> : null}
      {error ? <ErrorNote message={error} /> : null}
      {data && data.books.length === 0 ? <EmptyNote>No books in this category yet.</EmptyNote> : null}

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

function titleFromSlug(slug: string | undefined): string {
  if (!slug) return "Category";
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
