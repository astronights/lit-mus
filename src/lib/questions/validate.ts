import { normaliseForMatch } from "@/lib/proper-nouns";

/**
 * Validation of generated questions (Section 5a).
 *
 * **Scope changed deliberately.** The original design required every `detail`
 * answer to appear verbatim in the fetched text, on the reasoning that a wrong
 * answer you memorise is worse than no answer. In practice that rule also
 * ruled out the questions actually worth asking -- the ones that connect the
 * book to something real, which a plot summary never states outright.
 *
 * So the model now writes from its own knowledge as well as the supplied
 * article text, and the verbatim check is gone. What remains is the check that
 * needs no outside truth to evaluate:
 *
 *   a riddle must not contain its own answer.
 *
 * That is a property of the string itself, so it stays enforceable. The
 * accuracy of a detail answer is now the model's responsibility, backstopped by
 * the `reported` flag rather than by automated validation.
 */

export type ValidatedQuestion = {
  type: "title_riddle" | "detail";
  questionText: string;
  answer: string;
};

export type ValidationContext = {
  title: string;
  author: string | null;
  /** Character names, used only to stop the riddle naming one. */
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
    const detail = validateDetail(raw as RawQuestion, context, riddle?.questionText ?? null);
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
    // The answer to a title riddle is the title, whatever the model echoed back.
    answer: context.title,
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

  /*
   * Character names are deliberately *not* rejected here any more.
   *
   * A famous character is one of the best clues a quizmaster has, and banning
   * the lot left riddles for obscure books with nothing a reader could grab:
   * precise, and unguessable. The useful distinction is fame -- Big Brother
   * yes, an invented schoolmaster no -- and fame is a judgement the model makes
   * from the article, not something checkable from the string. It lives in the
   * prompt's anchor rule instead, with the rest of the taste.
   *
   * The leak case this used to cover is already covered twice over: a book
   * named for its protagonist is caught by the title check above (Emma,
   * Jane Eyre, Black Beauty) or by the distinctive-title-word check
   * (Anna Karenina). Naming the character there is naming the title, however
   * the riddle phrases it.
   */
  return null;
}

const TITLE_STOPWORDS = new Set([
  "about", "after", "again", "their", "there", "these", "those", "which", "while", "story",
  "novel", "being", "other", "where", "would", "could", "should", "years", "thing", "things",
]);

/**
 * Detail questions are taken on trust now, apart from three things that are
 * self-evident from the strings alone.
 *
 * The third is the one that bites most often: a card plays riddle first, then
 * the details, so an answer the riddle already stated has been handed to the
 * player a moment earlier. It tests nothing.
 */
function validateDetail(
  raw: RawQuestion,
  context: ValidationContext,
  riddleText: string | null,
): ValidatedQuestion | null {
  const question = asText(raw?.question);
  const answer = asText(raw?.answer);
  if (!question || !answer) return null;

  const normalisedAnswer = normaliseForMatch(answer);

  // An answer that is just the title or the author is the riddle again.
  if (titleRestatements(context.title).has(normalisedAnswer)) return null;
  // Deliberately exact, unlike the title. Matching on surname alone would
  // discard "Percy Bysshe Shelley" as an answer for a book by Mary Shelley,
  // and a detail answer that happens to share a surname with the author is a
  // real question far more often than it is a mistake.
  if (context.author && normalisedAnswer === normaliseForMatch(context.author)) return null;

  if (riddleText && answerGivenAwayBy(normalisedAnswer, riddleText)) {
    console.warn(
      `[questions] discarding detail for "${context.title}": ` +
        `the riddle already names "${answer}"`,
    );
    return null;
  }

  return { type: "detail", questionText: question, answer };
}

/**
 * The forms in which a detail answer is really just the title again.
 *
 * Exact equality was too narrow. A model that has been told not to answer with
 * the title does not usually answer with the title — it answers with the title
 * missing its article, or with the subtitle trimmed off, and the card then
 * plays as riddle-then-riddle.
 *
 * Kept to a closed set of variants rather than anything fuzzy. Generation is
 * one-shot, so a discarded question is gone for good, and a substring rule
 * would throw away perfectly good answers that happen to appear in a title.
 */
export function titleRestatements(title: string): Set<string> {
  const variants = new Set<string>();

  const add = (value: string) => {
    const normalised = normaliseForMatch(value);
    if (normalised) variants.add(normalised);
  };

  // "Saville: A Novel" comes back as "Saville" often enough to be worth it.
  const withoutSubtitle = title.split(":")[0];

  for (const base of [title, withoutSubtitle]) {
    add(base);
    add(base.replace(/^\s*(the|a|an)\s+/i, ""));
  }

  return variants;
}

/** Did the riddle already hand this answer to the player? */
export function answerGivenAwayBy(normalisedAnswer: string, riddleText: string): boolean {
  if (!normalisedAnswer) return false;
  const haystack = normaliseForMatch(riddleText);
  // Whole-phrase match, so "London" in the riddle catches a "London" answer but
  // "Londonderry" does not trip on it.
  return new RegExp(`\\b${escapeRegExp(normalisedAnswer)}\\b`).test(haystack);
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
