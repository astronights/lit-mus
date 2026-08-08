"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ErrorNote, PageHeader, SignInPrompt } from "@/components/ui";
import type { BookQuestion } from "@/lib/books";
import type { DrillCard } from "@/lib/drill";
import { explainEmptySession, type CardUnavailable } from "@/lib/drill-status";
import { shelfColour } from "@/lib/shelf";

/**
 * Ids are fetched a couple at a time rather than a sessionful up front.
 *
 * They are cheap -- one query, no hydration -- but paging means a session is
 * not capped at an arbitrary twelve, and the "n left" counter stops implying
 * that twelve books were loaded when only ids were.
 */
const PAGE_SIZE = 2;
/** Top up while one is still in hand, so the next card is never a cold start. */
const REFILL_AT = 1;

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
 *
 * Cards are fetched one at a time. A book nobody has opened needs Wikipedia and
 * a Gemini call before it can be asked about, so the wait is real and is shown
 * rather than hidden.
 */
export default function DrillPage() {
  const [queue, setQueue] = useState<number[]>([]);
  const [served, setServed] = useState<number[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<DrillCard | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [summary, setSummary] = useState<CardOutcome | null>(null);
  const [completed, setCompleted] = useState(0);
  // Why books were dropped, so the empty state can say something true.
  const [dropped, setDropped] = useState<CardUnavailable[]>([]);
  const [dropDetail, setDropDetail] = useState<string | undefined>(undefined);

  const loadingIds = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingIds.current) return;
    loadingIds.current = true;

    try {
      const exclude = servedRef.current.join(",");
      const response = await fetch(
        `/api/drill/session?size=${PAGE_SIZE}${exclude ? `&exclude=${exclude}` : ""}`,
      );

      if (response.status === 401) {
        setUnauthorized(true);
        return;
      }
      if (!response.ok) throw new Error(`Request failed (${response.status})`);

      const { bookIds } = (await response.json()) as { bookIds: number[] };
      if (bookIds.length === 0) {
        setExhausted(true);
        return;
      }

      setQueue((current) => [...current, ...bookIds]);
      setServed((current) => [...current, ...bookIds]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      loadingIds.current = false;
      setLoading(false);
    }
  }, []);

  // `served` in a ref as well, so loadMore stays stable and does not re-create
  // itself on every page -- which would retrigger the effects that call it.
  const servedRef = useRef<number[]>([]);
  useEffect(() => {
    servedRef.current = served;
  }, [served]);

  useEffect(() => {
    void loadMore();
  }, [loadMore]);

  // Top up while a card is still in hand.
  useEffect(() => {
    if (!exhausted && !loading && queue.length <= REFILL_AT) void loadMore();
  }, [queue.length, exhausted, loading, loadMore]);

  const restart = useCallback(() => {
    setQueue([]);
    setServed([]);
    servedRef.current = [];
    setExhausted(false);
    setError(null);
    setDropped([]);
    setDropDetail(undefined);
    setCompleted(0);
    setLoading(true);
    void loadMore();
  }, [loadMore]);

  /*
   * Fetch the card at the head of the queue.
   *
   * A book that cannot produce questions is dropped and the next id tried,
   * which is invisible to the player -- from their side it is simply the next
   * book, so the loading state covers the whole hunt rather than each attempt.
   *
   * `generation_unavailable` is the exception. It means the deployment has no
   * Gemini key, so every remaining book would fail the same way; the queue is
   * abandoned rather than hydrating eleven more books to prove it.
   */
  const wanted = queue[0] ?? null;
  const inFlight = useRef<number | null>(null);

  useEffect(() => {
    if (wanted === null || card !== null || summary !== null) return;
    if (inFlight.current === wanted) return;
    inFlight.current = wanted;

    let cancelled = false;
    setCardLoading(true);

    fetch(`/api/drill/card/${wanted}`)
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) throw new Error(`Request failed (${response.status})`);

        const result = (await response.json()) as
          | { card: DrillCard }
          | { card: null; reason: CardUnavailable; detail?: string };

        if (result.card) {
          setCard(result.card);
          return;
        }

        setDropped((current) => [...current, result.reason]);
        if (result.detail) setDropDetail((current) => current ?? result.detail);
        // Both of these are properties of the deployment rather than the book,
        // so every remaining id would fail identically. Stop rather than
        // hydrate eleven more books to prove it.
        const fatal =
          result.reason === "generation_unavailable" ||
          result.reason === "generation_failed" ||
          result.reason === "quota_exceeded";
        setQueue((current) => (fatal ? [] : current.filter((id) => id !== wanted)));
      })
      .catch(() => {
        if (cancelled) return;
        setDropped((current) => [...current, "unreachable" as const]);
        setQueue((current) => current.filter((id) => id !== wanted));
      })
      .finally(() => {
        if (!cancelled) {
          setCardLoading(false);
          inFlight.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [wanted, card, summary]);

  const question: BookQuestion | undefined = card?.questions[questionIndex];
  // The riddle is the whole point of step 1: nothing about the book is shown
  // until it has been answered, missed, or skipped.
  const identified = questionIndex > 0 || summary !== null;

  const finishCard = useCallback(
    async (finalAnswers: Answer[]) => {
      if (!card) return;

      const response = await fetch("/api/drill/result", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookId: card.bookId, answers: finalAnswers }),
      });

      setSummary(
        response.ok
          ? ((await response.json()) as CardOutcome)
          : { box: card.box, dueAt: new Date().toISOString(), cleanPass: false, recorded: false },
      );
    },
    [card],
  );

  const answer = useCallback(
    (outcome: "got_it" | "missed") => {
      if (!card || !question) return;

      const next = [...answers, { questionId: question.id, outcome }];
      setAnswers(next);
      setRevealed(false);

      if (questionIndex + 1 >= card.questions.length) void finishCard(next);
      else setQuestionIndex(questionIndex + 1);
    },
    [answers, card, finishCard, question, questionIndex],
  );

  const advance = useCallback(() => {
    setSummary(null);
    setCard(null);
    setAnswers([]);
    setQuestionIndex(0);
    setRevealed(false);
    setQueue((current) => current.slice(1));
  }, []);

  /**
   * Skip drops the whole book, from any question.
   *
   * Nothing is recorded: no `DrillResult`, no box change, no due date. Skip
   * means "not this one, not now", which is a different thing from getting it
   * wrong and must not be allowed to affect scheduling.
   */
  const skip = useCallback(() => {
    setCompleted((value) => value + 1);
    advance();
  }, [advance]);

  const nextCard = useCallback(() => {
    setCompleted((value) => value + 1);
    advance();
  }, [advance]);

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

  if (loading) {
    return (
      <>
        <SessionProgress remaining={0} completed={0} />
        <LoadingCard label="Building your session…" />
      </>
    );
  }

  if (error) return <ErrorNote message={error} />;

  if (summary && card) {
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
                <strong>box {summary.box}</strong>, due {formatDue(summary.dueAt)}.
              </>
            ) : (
              "Nothing recorded."
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

  // Also covers the gap where the queue has emptied and the next page of ids is
  // still in flight -- without it the screen flashes "Session done" mid-session.
  if (cardLoading || (wanted !== null && !card) || (!exhausted && queue.length === 0)) {
    return (
      <>
        <SessionProgress remaining={queue.length} completed={completed} />
        <LoadingCard label="Fetching the next book…" hint="First time for this one — reading Wikipedia and writing questions." />
      </>
    );
  }

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
              onClick={restart}
              className="ink-button mt-4 bg-accent px-4 py-2 font-display text-lg text-accent-foreground"
            >
              Another session
            </button>
          </div>
        ) : (
          <div className="ink-card p-5 text-center">
            <p className="text-sm">{explainEmptySession(dropped, dropDetail)}</p>
            {dropped.length > 0 ? (
              <button
                type="button"
                onClick={restart}
                className="ink-button mt-4 bg-surface px-4 py-2 font-display text-lg"
              >
                Try again
              </button>
            ) : null}
          </div>
        )}
      </>
    );
  }

  if (!question) return <LoadingCard label="Loading…" />;

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
          Skip this book
        </button>
        <p className="mt-2 text-center text-[11px] opacity-70">
          Skipping records nothing and moves on. A book only advances a box if you get all
          {" "}
          {card.questions.length} right.
        </p>
      </div>

      <p className="mt-3 text-center text-xs opacity-70">
        Question {questionIndex + 1} of {card.questions.length} · box {card.box}
      </p>
    </>
  );
}

/** Drawn loading block, so a slow first fetch looks intentional. */
function LoadingCard({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="ink-card p-8 text-center" role="status" aria-live="polite">
      <span className="mx-auto flex w-fit gap-1.5" aria-hidden>
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-4 w-3 rounded-sm border-2 border-ink bg-accent"
            style={{ animation: `drill-book 900ms ${index * 140}ms ease-in-out infinite` }}
          />
        ))}
      </span>
      <p className="mt-4 font-display text-lg">{label}</p>
      {hint ? <p className="mt-1 text-xs opacity-70">{hint}</p> : null}
      <style>{`@keyframes drill-book {
        0%, 100% { transform: translateY(0) }
        50% { transform: translateY(-7px) }
      }`}</style>
    </div>
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
      className="mt-3 w-full text-xs underline underline-offset-2 opacity-70 disabled:opacity-40"
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
