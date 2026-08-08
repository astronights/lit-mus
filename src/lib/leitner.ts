/**
 * Leitner box scheduling (Section 5b).
 *
 * The card is the book, so a box belongs to a book, not to a question. A
 * session against a book yields three outcomes (or fewer, if questions were
 * skipped), and the *set* of them decides the move:
 *
 *   3/3   -> promote one box, due per the interval table
 *   1-2/3 -> stay in box, due next session
 *   0/3   -> demote to box 1
 *
 * Box 5 is the "known it" state, but it still comes round every ~6 weeks
 * rather than vanishing -- permanent retirement is a manual choice, not
 * something inferred from three lucky guesses.
 */

export const MIN_BOX = 1;
export const MAX_BOX = 5;

/** Days until a book is due again after a clean pass, indexed by new box. */
export const BOX_INTERVAL_DAYS: Record<number, number> = {
  1: 0, // same session, then next session
  2: 2,
  3: 5,
  4: 14,
  5: 42,
};

export type DrillOutcome = "got_it" | "missed";

export type SchedulingInput = {
  box: number;
  /** One entry per question actually answered. Skips are not included. */
  outcomes: DrillOutcome[];
  /** Total questions on the card, so a fully skipped card is recognisable. */
  questionCount: number;
  now?: Date;
};

export type SchedulingResult = {
  box: number;
  dueAt: Date;
  /** True when every question on the card was answered correctly. */
  cleanPass: boolean;
  /** False when nothing was answered -- caller should not record an attempt. */
  counted: boolean;
};

/**
 * Where does this book go next?
 *
 * A card where everything was skipped returns `counted: false`: skip is
 * neutral by design, so it must not move the box, touch the due date, or count
 * as an attempt.
 */
export function scheduleNext({
  box,
  outcomes,
  questionCount,
  now = new Date(),
}: SchedulingInput): SchedulingResult {
  const currentBox = clampBox(box);

  if (outcomes.length === 0) {
    return { box: currentBox, dueAt: now, cleanPass: false, counted: false };
  }

  const correct = outcomes.filter((outcome) => outcome === "got_it").length;
  const cleanPass = correct === questionCount && questionCount > 0;

  let nextBox: number;
  if (cleanPass) {
    nextBox = clampBox(currentBox + 1);
  } else if (correct === 0) {
    nextBox = MIN_BOX;
  } else {
    nextBox = currentBox;
  }

  return {
    box: nextBox,
    dueAt: cleanPass ? addDays(now, BOX_INTERVAL_DAYS[nextBox] ?? 0) : nextSession(now),
    cleanPass,
    counted: true,
  };
}

/**
 * "Due next session" needs a concrete timestamp. Start of tomorrow is the
 * honest reading: a partial or failed card should come back, but not five
 * minutes later in the same sitting, which would just be re-reading.
 */
export function nextSession(now: Date): Date {
  const tomorrow = new Date(now);
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function clampBox(box: number): number {
  if (!Number.isFinite(box)) return MIN_BOX;
  return Math.min(MAX_BOX, Math.max(MIN_BOX, Math.round(box)));
}

/* -------------------------------------------------------------------------- */
/* Session composition                                                        */
/* -------------------------------------------------------------------------- */

export const SESSION_SIZE = 12;
/** How many never-drilled books to fold in, to keep coverage expanding. */
export const NEW_BOOKS_PER_SESSION = 3;

export type Candidate = {
  bookId: number;
  box: number | null;
  dueAt: Date | null;
};

/**
 * Build a session queue.
 *
 * Priority (Section 5b): due books first, then a few never-drilled ones, then
 * a weighted top-up from not-yet-due books biased toward lower boxes. Pure
 * random would keep serving books you already know.
 */
export function composeSession(
  candidates: Candidate[],
  {
    size = SESSION_SIZE,
    newBooks = NEW_BOOKS_PER_SESSION,
    now = new Date(),
    random = Math.random,
  }: { size?: number; newBooks?: number; now?: Date; random?: () => number } = {},
): number[] {
  const due: Candidate[] = [];
  const fresh: Candidate[] = [];
  const notYetDue: Candidate[] = [];

  for (const candidate of candidates) {
    if (candidate.box === null || candidate.dueAt === null) fresh.push(candidate);
    else if (candidate.dueAt <= now) due.push(candidate);
    else notYetDue.push(candidate);
  }

  // Oldest due first: a book overdue by a month needs the pass more than one
  // that came due this morning.
  due.sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0));

  const queue: number[] = [];
  const seen = new Set<number>();
  const take = (candidate: Candidate) => {
    if (seen.has(candidate.bookId) || queue.length >= size) return;
    seen.add(candidate.bookId);
    queue.push(candidate.bookId);
  };

  // Leave room for the new books unless the due queue can't fill the session.
  const dueBudget = Math.max(size - Math.min(newBooks, fresh.length), 0);
  for (const candidate of due.slice(0, dueBudget)) take(candidate);

  const shuffled = shuffle(fresh, random);
  for (const candidate of shuffled.slice(0, newBooks)) take(candidate);

  // Due books beyond the budget, if the new-book quota came up short.
  for (const candidate of due) take(candidate);

  for (const candidate of weightedByBox(notYetDue, random)) take(candidate);

  // Finally, more never-drilled books. Without this a user with nothing in
  // rotation yet -- which is everyone on day one, and anyone whose books are
  // all in the higher boxes -- gets a session of exactly `newBooks` cards and
  // then "session done". The quota is there to stop new books crowding out due
  // ones, not to cap a session that has nothing else to offer.
  for (const candidate of shuffled) take(candidate);

  return queue;
}

/**
 * Order not-yet-due books so low boxes come first with some jitter -- a box 1
 * book is far more worth a pre-emptive look than a box 5 one.
 */
function weightedByBox(candidates: Candidate[], random: () => number): Candidate[] {
  return [...candidates]
    .map((candidate) => ({
      candidate,
      key: (candidate.box ?? MIN_BOX) + random() * 1.5,
    }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.candidate);
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
