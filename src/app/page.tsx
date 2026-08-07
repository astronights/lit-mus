"use client";

import Link from "next/link";

import { EmptyNote, ErrorNote, Loading, PageHeader } from "@/components/ui";
import { useApi } from "@/lib/use-api";

type CategoryRow = {
  id: number;
  slug: string;
  name: string;
  type: string;
  total: number;
  hydrated: number;
};

/**
 * Tab 1 -- Browse. Category-driven discovery: the landing view is the list of
 * categories with counts, and tapping one gives its books.
 */
export default function BrowsePage() {
  const { data, error, loading } = useApi<{ categories: CategoryRow[] }>("/api/categories");

  return (
    <>
      <PageHeader title="Browse" subtitle="Categories, and how much of each you've opened." />

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
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-muted"
            >
              <span className="min-w-0">
                <span className="block truncate font-display text-[15px] font-semibold">
                  {category.name}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {category.hydrated} / {category.total} opened
                </span>
              </span>
              <CoverageBar hydrated={category.hydrated} total={category.total} />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function CoverageBar({ hydrated, total }: { hydrated: number; total: number }) {
  const fraction = total > 0 ? Math.min(1, hydrated / total) : 0;
  return (
    <span
      className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-muted"
      aria-hidden
    >
      <span
        className="block h-full rounded-full bg-accent"
        style={{ width: `${Math.round(fraction * 100)}%` }}
      />
    </span>
  );
}
