"use client";

import Link from "next/link";

import { ErrorNote, Loading, PageHeader, SignInPrompt } from "@/components/ui";
import type { ProgressSummary } from "@/lib/drill";
import { useApi } from "@/lib/use-api";

/**
 * Tab 4 -- Progress. Coverage per category plus the box distribution.
 *
 * The box numbers are the motivating ones: watching books climb from box 1 to
 * box 5 is the actual progress signal, where coverage only says what you've
 * looked at.
 */
export default function ProgressPage() {
  const { data, error, loading, unauthorized } = useApi<ProgressSummary>("/api/progress");

  if (unauthorized) {
    return (
      <>
        <PageHeader title="Progress" />
        <SignInPrompt what="Progress" />
      </>
    );
  }

  if (loading) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;

  const maxBox = Math.max(1, ...data.boxes.map((box) => box.count));

  return (
    <>
      <PageHeader title="Progress" subtitle={`${data.dueToday} due now · ${data.drilledBooks} books in rotation`} />

      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Leitner boxes
        </h2>
        <ul className="mt-3 space-y-2">
          {data.boxes.map((box) => (
            <li key={box.box} className="flex items-center gap-3">
              <span className="w-12 shrink-0 text-xs text-muted-foreground">Box {box.box}</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${Math.round((box.count / maxBox) * 100)}%` }}
                />
              </span>
              <span className="w-8 shrink-0 text-right text-xs tabular-nums">{box.count}</span>
              <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground">
                {box.intervalDays === 0 ? "next session" : `~${box.intervalDays}d`}
              </span>
            </li>
          ))}
        </ul>
        {data.retired > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {data.retired} manually retired.
          </p>
        ) : null}
      </section>

      <section className="mt-4 rounded-xl border border-border bg-surface p-4">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Coverage
        </h2>
        <ul className="mt-3 space-y-1.5">
          {data.categories.map((category) => (
            <li key={category.slug} className="flex items-baseline justify-between gap-3 text-sm">
              <Link href={`/browse/${category.slug}`} className="truncate hover:text-accent">
                {category.name}
              </Link>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {category.hydrated} / {category.total}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {data.struggling.length > 0 ? (
        <section className="mt-4 rounded-xl border border-border bg-surface p-4">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Consistently missed
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Stuck in box 1–2 after several attempts. Sometimes a genuine gap, sometimes a badly
            generated question — worth a look.
          </p>
          <ul className="mt-3 space-y-1.5">
            {data.struggling.map((book) => (
              <li key={book.bookId} className="flex items-baseline justify-between gap-3 text-sm">
                <Link href={`/books/${book.bookId}`} className="truncate hover:text-accent">
                  {book.title}
                </Link>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {book.missed} missed · {book.attempts} tries
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
