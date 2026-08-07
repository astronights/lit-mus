import { appearsInSource, normaliseForMatch } from "@/lib/proper-nouns";

/**
 * Validation of generated questions (Section 5a).
 *
 * The failure mode that matters is a hallucinated answer: a wrong answer you
 * memorise is worse than no answer at all. So a `detail` answer must appear
 * verbatim in the text the model was given, and a riddle must not leak the
 * title or author.
 *
 * Weak-but-honest questions are allowed through. There is no review queue: a
 * merely weak question is not worth gating everything behind a manual step.
 *
 * A question that fails validation is stored with `pending_review` set and is
 * excluded from every read path (see `src/lib/questions/read.ts`). Storing it
 * rather than dropping it is what lets the maintenance script find and fix the
 * failures later -- generation is one-shot, so a dropped question is gone.
 */

export type ValidatedQuestion = {
  type: "title_riddle" | "detail";
  questionText: string;
  answer: string;
  /** Kept, but flagged: shown to the user and findable by a maintenance script. */
  pendingReview: boolean;
  reviewReason?: string;
};

export type ValidationContext = {
  title: string;
  author: string | null;
  plotText: string;
  characterNames: string[];
};

export class QuestionParseError extends Error {}

type RawQuestion = { question?: unknown; answer?: unknown };
type RawPayload = { title_riddle?: RawQuestion | null; detail_questions?: unknown };

/**
 * Parse the model's response into JSON.
 *
 * We ask for `responseMimeType: application/json`, but a stray ```json fence
 * still shows up occasionally, so strip one before giving up.
 */
export function parseGenerationResponse(text: string): RawPayload {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    const parsed: unknown = JSON.parse(withoutFence);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new QuestionParseError("Generation response was not a JSON object");
    }
    return parsed as RawPayload;
  } catch (error) {
    if (error instanceof QuestionParseError) throw error;
    throw new QuestionParseError(
      `Generation response was not valid JSON: ${(error as Error).message}`,
    );
  }
}

export function validateQuestions(
  payload: RawPayload,
  context: ValidationContext,
): ValidatedQuestion[] {
  const questions: ValidatedQuestion[] = [];

  const riddle = validateRiddle(payload.title_riddle, context);
  if (riddle) questions.push(riddle);

  const details = Array.isArray(payload.detail_questions) ? payload.detail_questions : [];
  for (const raw of details.slice(0, 2)) {
    const detail = validateDetail(raw as RawQuestion, context);
    if (detail) questions.push(detail);
  }

  return questions;
}

function validateRiddle(
  raw: RawQuestion | null | undefined,
  context: ValidationContext,
): ValidatedQuestion | null {
  if (!raw) return null;
  const question = asText(raw.question);
  if (!question) return null;

  // The answer to a title riddle is the title, whatever the model echoed back.
  const leak = riddleLeak(question, context);
  if (leak) {
    // A riddle that names the book is not a riddle; there is no salvaging it,
    // and showing it would spoil the one question type Drill is built around.
    console.warn(`[questions] discarding riddle for "${context.title}": leaks ${leak}`);
    return null;
  }

  return {
    type: "title_riddle",
    questionText: question,
    answer: context.title,
    pendingReview: false,
  };
}

/** Which part of the answer the riddle gave away, or null if it's clean. */
export function riddleLeak(question: string, context: ValidationContext): string | null {
  const haystack = normaliseForMatch(question);

  if (haystack.includes(normaliseForMatch(context.title))) return "title";

  if (context.author) {
    const surname = context.author.trim().split(/\s+/).pop();
    if (surname && surname.length > 3 && haystack.includes(normaliseForMatch(surname))) {
      return "author";
    }
  }

  // Distinctive words from the title, so "the seven moons of ..." can't come
  // back as "seven moons". Short and common words are ignored: a title like
  // "The Sea" would otherwise make every riddle unusable.
  const titleWords = normaliseForMatch(context.title)
    .split(" ")
    .filter((word) => word.length > 4 && !TITLE_STOPWORDS.has(word));
  for (const word of titleWords) {
    if (new RegExp(`\\b${escapeRegExp(word)}\\b`).test(haystack)) return `title word "${word}"`;
  }

  for (const name of context.characterNames) {
    const normalised = normaliseForMatch(name);
    if (normalised.length > 3 && haystack.includes(normalised)) return `character "${name}"`;
  }

  return null;
}

const TITLE_STOPWORDS = new Set([
  "about", "after", "again", "their", "there", "these", "those", "which", "while", "story",
  "novel", "being", "other", "where", "would", "could", "should", "years", "thing", "things",
]);

function validateDetail(
  raw: RawQuestion,
  context: ValidationContext,
): ValidatedQuestion | null {
  const question = asText(raw?.question);
  const answer = asText(raw?.answer);
  if (!question || !answer) return null;

  // An answer the model could not have read is the one thing we refuse to
  // store silently. Flag rather than drop: it may be a formatting difference
  // ("Mr Rochester" vs "Rochester") rather than an invention, and the flag is
  // what the maintenance script looks for.
  const grounded = appearsInSource(answer, [context.plotText, ...context.characterNames]);

  return {
    type: "detail",
    questionText: question,
    answer,
    pendingReview: !grounded,
    reviewReason: grounded ? undefined : "answer not found verbatim in source text",
  };
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
