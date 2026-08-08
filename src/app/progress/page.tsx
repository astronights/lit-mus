"use client";

import Link from "next/link";

import { LicenceNote } from "@/components/licence-note";
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
        <SettingsLink />
        <LicenceNote />
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

      <section className="ink-card p-4">
        <h2 className="font-display text-base uppercase tracking-wide opacity-70">
          Leitner boxes
        </h2>
        <ul className="mt-3 space-y-2">
          {data.boxes.map((box) => (
            <li key={box.box} className="flex items-center gap-3">
              <span className="w-12 shrink-0 text-xs text-muted-foreground">Box {box.box}</span>
              <span className="h-4 flex-1 overflow-hidden rounded-full border-2 border-ink bg-surface">
                <span
                  className="block h-full bg-accent"
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

      <section className="ink-card mt-4 p-4">
        <h2 className="font-display text-base uppercase tracking-wide opacity-70">
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
        <section className="ink-card mt-4 p-4">
          <h2 className="font-display text-base uppercase tracking-wide opacity-70">
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

      <SettingsLink />
      <LicenceNote />
    </>
  );
}

/**
 * Settings lived only in the old site-wide footer, which meant removing that
 * footer would have orphaned the theme and font pickers entirely. Progress is
 * the right home: it is the tab you open deliberately rather than pass through.
 */
function SettingsLink() {
  return (
    <Link
      href="/settings"
      className="ink-button mt-6 flex w-full items-center justify-center gap-2 bg-surface px-4 py-3 font-display text-lg"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="3.2" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.6a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
      </svg>
      Settings
    </Link>
  );
}
