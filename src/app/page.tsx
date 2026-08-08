"use client";

import Link from "next/link";

import { EmptyNote, ErrorNote, Loading, PageHeader } from "@/components/ui";
import { shelfColour } from "@/lib/shelf";
import { useApi } from "@/lib/use-api";

type CategoryRow = {
  id: number;
  slug: string;
  name: string;
  type: string;
};

/**
 * Tab 1 -- Browse. Category-driven discovery: the landing view is the list of
 * categories with counts, and tapping one gives its books.
 */
export default function BrowsePage() {
  const { data, error, loading } = useApi<{ categories: CategoryRow[] }>("/api/categories");

  return (
    <>
      <PageHeader title="Browse" subtitle="Pick a shelf." />

      {loading ? <Loading /> : null}
      {error ? <ErrorNote message={error} /> : null}

      {data && data.categories.length === 0 ? (
        <EmptyNote>
          Nothing seeded yet. Run <code className="font-mono">npm run seed</code>.
        </EmptyNote>
      ) : null}

      <ul className="space-y-2">
        {data?.categories.map((category) => (
          <li key={category.id}>
            <Link
              href={`/browse/${category.slug}`}
              data-shelf={shelfColour(category.id)}
              className="ink-card ink-button flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0 truncate font-display text-lg leading-tight">
                {category.name}
              </span>
              <span aria-hidden className="shrink-0 font-display text-lg opacity-60">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
