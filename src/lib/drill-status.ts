/**
 * Why a book could not produce a drill card, and what to say about it.
 *
 * Kept apart from `@/lib/drill` because that module imports the database: this
 * is pure, and putting it here is what lets the wording be unit-tested without
 * a DATABASE_URL.
 */

/**
 * `generation_unavailable` is the one that matters. It is not a property of the
 * book but of the deployment -- no Gemini key -- so it is true of every other
 * book too. Reporting it lets the client stop rather than hydrate a whole queue
 * to discover the same thing twelve times.
 */
export type CardUnavailable =
  | "not_found"
  | "unreachable"
  | "no_questions"
  | "generation_unavailable"
  | "throttled";

/**
 * What to tell someone whose session produced no cards at all.
 *
 * The empty state used to say "seed some books first" whatever went wrong,
 * which on a shelf of two thousand books sent you looking in exactly the wrong
 * place.
 */
export function explainEmptySession(reasons: CardUnavailable[]): string {
  if (reasons.length === 0) {
    return "Nothing to drill yet — seed some books with `npm run seed`.";
  }
  if (reasons.includes("generation_unavailable")) {
    return "Questions can't be generated: GEMINI_API_KEY isn't set on this deployment.";
  }
  if (reasons.includes("throttled")) {
    return "Hit the question-generation rate limit. Give it a minute and try again.";
  }
  if (reasons.every((reason) => reason === "unreachable")) {
    return "Couldn't reach Wikipedia or Open Library just now. Try again in a moment.";
  }
  return `Tried ${reasons.length} ${reasons.length === 1 ? "book" : "books"}, none had enough in its Wikipedia article to ask about. Try another session.`;
}
