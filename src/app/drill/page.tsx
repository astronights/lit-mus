"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyNote, ErrorNote, Loading, PageHeader, SignInPrompt } from "@/components/ui";
import type { BookQuestion } from "@/lib/books";
import type { DrillCard } from "@/lib/drill";
import { shelfColour } from "@/lib/shelf";
import { useApi } from "@/lib/use-api";

type Answer = { questionId: number; outcome: "got_it" | "missed" };

type CardOutcome = {
  box: number;
  dueAt: string;
  cleanPass: boolean;
  recorded: boolean;
};

/**
 * Tab 3 -- Drill. The study loop, and the reason the app exists rather than
 * being a spreadsheet.
 *
 * The unit is the book: one card is one book played as riddle -> detail ->
 * detail. Missing the riddle still reveals the answer and continues into the
 * details, because the goal is learning rather than scoring -- aborting on a
 * miss would deny the exact repetition you most need.
 */
export default function DrillPage() {
  const { data, error, loading, unauthorized, reload } = useApi<{ cards: DrillCard[] }>(
    "/api/drill/session",
  );

  const [queue, setQueue] = useState<DrillCard[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [summary, setSummary] = useState<CardOutcome | null>(null);
  const [completed, setCompleted] = useState(0);

  useEffect(() => {
    if (data) setQueue(data.cards);
  }, [data]);

  const card = queue[0] ?? null;
  const question: BookQuestion | undefined = card?.questions[questionIndex];
  // The riddle is the whole point of step 1: nothing about the book is shown
  // until it has been answered, missed, or skipped.
  const identified = questionIndex > 0 || summary !== null;

  const resetCard = useCallback(() => {
    setAnswers([]);
    setQuestionIndex(0);
    setRevealed(false);
  }, []);

  const finishCard = useCallback(
    async (finalAnswers: Answer[]) => {
      if (!card) return;

      const response = await fetch("/api/drill/result", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookId: card.bookId, answers: finalAnswers }),
      });

      const outcome = response.ok
        ? ((await response.json()) as CardOutcome)
        : { box: card.box, dueAt: new Date().toISOString(), cleanPass: false, recorded: false };

      setSummary(outcome);
    },
    [card],
  );

  const answer = useCallback(
    (outcome: "got_it" | "missed") => {
      if (!card || !question) return;

      const next = [...answers, { questionId: question.id, outcome }];
      setAnswers(next);
      setRevealed(false);

      if (questionIndex + 1 >= card.questions.length) {
        void finishCard(next);
      } else {
        setQuestionIndex(questionIndex + 1);
      }
    },
    [answers, card, finishCard, question, questionIndex],
  );

  /**
   * Skip is neutral, not a miss: nothing is recorded and the card comes back
   * later in this session. Skipping the riddle parks the whole card, since
   * being shown the title would spoil it on the second pass.
   */
  const skip = useCallback(() => {
    if (!card) return;

    if (questionIndex === 0) {
      setQueue((current) => [...current.slice(1), current[0]!]);
      resetCard();
      return;
    }

    setRevealed(false);
    if (questionIndex + 1 >= card.questions.length) {
      void finishCard(answers);
    } else {
      setQuestionIndex(questionIndex + 1);
    }
  }, [answers, card, finishCard, questionIndex, resetCard]);

  const nextCard = useCallback(() => {
    setSummary(null);
    setCompleted((value) => value + 1);
    setQueue((current) => current.slice(1));
    resetCard();
  }, [resetCard]);

  const correct = useMemo(
    () => answers.filter((entry) => entry.outcome === "got_it").length,
    [answers],
  );

  if (unauthorized) {
    return (
      <>
        <PageHeader title="Drill" />
        <SignInPrompt what="Drill" />
      </>
    );
  }

  if (loading) return <Loading label="Building your session…" />;
  if (error) return <ErrorNote message={error} />;

  if (!card) {
    return (
      <>
        <PageHeader title="Drill" />
        {completed > 0 ? (
          <div className="ink-card p-5 text-center">
            <p className="font-display text-2xl">Session done</p>
            <p className="mt-1 text-sm opacity-70">
              {completed} {completed === 1 ? "book" : "books"} drilled.
            </p>
            <button
              type="button"
              onClick={reload}
              className="ink-button mt-4 bg-accent px-4 py-2 font-display text-lg text-accent-foreground"
            >
              Another session
            </button>
          </div>
        ) : (
          <EmptyNote>
            Nothing to drill yet. Open a few books from Browse first — a book becomes drillable
            once it has been hydrated and has questions.
          </EmptyNote>
        )}
      </>
    );
  }

  if (summary) {
    return (
      <>
        <SessionProgress remaining={queue.length} completed={completed} />
        <div className="ink-card p-5 text-center" data-shelf={shelfColour(card.bookId)}>
          <p className="text-xs uppercase tracking-wide opacity-70">Card summary</p>
          <p className="mt-2 font-display text-4xl">
            {correct} / {card.questions.length}
          </p>
          <p className="mt-1 font-display text-lg">{card.title}</p>

          <p className="mt-4 text-sm">
            {summary.recorded ? (
              <>
                {summary.cleanPass ? "Clean pass — promoted to " : "Box "}
                <strong className="text-foreground">box {summary.box}</strong>, due{" "}
                {formatDue(summary.dueAt)}.
              </>
            ) : (
              "Skipped — nothing recorded."
            )}
          </p>

          <button
            type="button"
            onClick={nextCard}
            className="ink-button mt-5 w-full bg-accent px-4 py-2.5 font-display text-lg text-accent-foreground"
          >
            Next card
          </button>
          <RetireButton bookId={card.bookId} onDone={nextCard} />
        </div>
      </>
    );
  }

  if (!question) return <Loading />;

  return (
    <>
      <SessionProgress remaining={queue.length} completed={completed} />

      <div className="ink-card p-5" data-shelf={identified ? shelfColour(card.bookId) : undefined}>
        {identified ? (
          <div className="mb-4 flex items-center gap-3 border-b-2 border-ink pb-4">
            {card.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={card.coverUrl}
                alt=""
                className="h-16 w-11 rounded border-2 border-ink object-cover"
              />
            ) : null}
            <div className="min-w-0">
              <p className="truncate font-display text-lg leading-tight">{card.title}</p>
              <p className="truncate text-xs opacity-70">{card.author}</p>
            </div>
          </div>
        ) : (
          <p className="mb-3 font-display text-sm uppercase tracking-wide text-accent">
            Title riddle
          </p>
        )}

        <p className="min-h-24 text-lg leading-snug">{question.questionText}</p>

        {revealed ? (
          <p className="mt-4 rounded-lg border-2 border-ink bg-surface px-3 py-2.5 font-display text-xl">
            {question.answer}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="mt-4 text-sm underline underline-offset-4"
          >
            Show answer
          </button>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => answer("got_it")}
            className="ink-button bg-success px-4 py-3 font-display text-lg text-accent-foreground"
          >
            Got it
          </button>
          <button
            type="button"
            onClick={() => answer("missed")}
            className="ink-button bg-danger px-4 py-3 font-display text-lg text-accent-foreground"
          >
            Missed
          </button>
        </div>
        <button
          type="button"
          onClick={skip}
          className="ink-button mt-2 w-full bg-surface px-4 py-2.5 text-sm"
        >
          Skip {questionIndex === 0 ? "this book" : "this question"}
        </button>
        <p className="mt-2 text-center text-[11px] opacity-70">
          Skipping records nothing and brings the card back later this session.
        </p>
      </div>

      <p className="mt-3 text-center text-xs opacity-70">
        Question {questionIndex + 1} of {card.questions.length} · box {card.box}
      </p>
    </>
  );
}

function SessionProgress({ remaining, completed }: { remaining: number; completed: number }) {
  return (
    <div className="mb-4 flex items-baseline justify-between">
      <h1 className="font-display text-3xl leading-tight">Drill</h1>
      <p className="text-xs opacity-70">
        {completed} done · {remaining} left
      </p>
    </div>
  );
}

function RetireButton({ bookId, onDone }: { bookId: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/drill/retire", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bookId, retired: true }),
        }).catch(() => {});
        onDone();
      }}
      className="mt-3 w-full text-xs text-muted-foreground underline underline-offset-2 disabled:opacity-50"
    >
      I&apos;ve got this — stop showing me
    </button>
  );
}

function formatDue(iso: string): string {
  const due = new Date(iso);
  const days = Math.round((due.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "next session";
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;
  return `in ${Math.round(days / 7)} weeks`;
}
