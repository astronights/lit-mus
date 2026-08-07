"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Chip, ErrorNote, Loading, PageHeader } from "@/components/ui";
import type { BookDetail, BookQuestion } from "@/lib/books";
import { useApi } from "@/lib/use-api";

/**
 * Book Detail -- a pushed screen, not a tab.
 *
 * The first open of a book triggers hydration server-side, so this request can
 * take a few seconds. Questions are not part of it: once the page has content,
 * it fires the background generation request and fills section 5 in when it
 * lands.
 */
export default function BookDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const { data, error, loading } = useApi<{ book: BookDetail; questionsPending: boolean }>(
    id ? `/api/books/${id}` : null,
  );

  const [questions, setQuestions] = useState<BookQuestion[] | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!data || !id) return;

    if (data.book.questions.length > 0) {
      setQuestions(data.book.questions);
      return;
    }
    if (!data.questionsPending) {
      // Generation already ran and produced nothing usable -- a thin article,
      // most likely. One-shot means it will not run again.
      setQuestions([]);
      return;
    }

    let cancelled = false;
    setGenerating(true);
    fetch(`/api/books/${id}/questions`, { method: "POST" })
      .then((response) => response.json())
      .then((result: { questions?: BookQuestion[] }) => {
        if (!cancelled) setQuestions(result.questions ?? []);
      })
      .catch(() => {
        if (!cancelled) setQuestions([]);
      })
      .finally(() => {
        if (!cancelled) setGenerating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [data, id]);

  if (loading) return <Loading label="Fetching this book…" />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;

  const book = data.book;

  return (
    <article className="pb-4">
      <Link href="/search" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>

      <div className="mt-3 flex gap-4">
        {book.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={book.coverUrl}
            alt={`Cover of ${book.title}`}
            className="h-36 w-24 shrink-0 rounded-lg object-cover shadow-sm"
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
          <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Plot
          </h2>
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
          <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
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

      <section className="mt-6">
        <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Questions
        </h2>

        {generating || questions === null ? (
          <p className="text-sm text-muted-foreground">Generating questions…</p>
        ) : questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No questions for this one — there wasn&apos;t enough plot text to write any honestly.
          </p>
        ) : (
          <ul className="space-y-2">
            {questions.map((question) => (
              <li key={question.id}>
                <QuestionCard question={question} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

/** Answers collapsed by default, so the screen doubles as a self-test. */
function QuestionCard({ question }: { question: BookQuestion }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-surface p-3.5">
      {question.type === "title_riddle" ? (
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-accent">
          Title riddle
        </span>
      ) : null}
      <p className="text-[15px] leading-relaxed">{question.questionText}</p>
      {revealed ? (
        <p className="mt-2 font-display text-[15px] font-semibold">{question.answer}</p>
      ) : (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="mt-2 text-sm font-medium text-accent"
        >
          Reveal answer
        </button>
      )}
    </div>
  );
}
