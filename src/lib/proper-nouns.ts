/**
 * Proper-noun extraction from plot text.
 *
 * Two jobs:
 *  - fallback character list when Wikidata has no P674 claims (common for
 *    anything outside the prize lists)
 *  - the vocabulary a generated `detail` answer is checked against
 *
 * This is a heuristic, not a parser. It over-collects slightly, which is the
 * right direction: a stray place name in the character list is a cosmetic
 * problem, a missing one silently fails validation for a correct answer.
 */

/** Words that start sentences constantly and are never characters. */
const STOPWORDS = new Set([
  "a", "after", "although", "an", "and", "as", "at", "back", "because", "before", "book",
  "both", "but", "by", "chapter", "despite", "during", "each", "eventually", "everyone",
  "finally", "following", "for", "from", "he", "her", "here", "his", "how", "however", "i",
  "if", "in", "instead", "into", "it", "its", "later", "meanwhile", "much", "never",
  "nevertheless", "next", "no", "nobody", "not", "novel", "now", "of", "on", "once", "one",
  "only", "or", "other", "part", "several", "she", "since", "so", "some", "soon", "still",
  "the", "their", "then", "there", "these", "they", "this", "those", "though", "thus", "to",
  "two", "until", "upon", "we", "what", "when", "where", "while", "who", "why", "with",
  "without", "yet", "you", "your",
]);

/** Titles that should stay attached to the name that follows them. */
const TITLES = new Set([
  "mr", "mrs", "ms", "miss", "dr", "sir", "lady", "lord", "captain", "colonel", "major",
  "professor", "father", "mother", "uncle", "aunt", "king", "queen", "prince", "princess",
  "saint", "st",
]);

const WORD = "[A-Z\\u00C0-\\u024F][\\w'’\\u00C0-\\u024F-]*";
const PHRASE = new RegExp(`${WORD}(?:\\s+(?:of|de|van|von|del|la|le|da|di)\\s+${WORD}|\\s+${WORD})*`, "g");

export type ProperNoun = { name: string; count: number };

/** Ranked proper nouns, most frequent first. */
export function extractProperNouns(text: string, limit = 25): ProperNoun[] {
  if (!text) return [];

  const counts = new Map<string, { display: string; count: number }>();

  for (const sentence of splitSentences(text)) {
    for (const match of sentence.matchAll(PHRASE)) {
      const phrase = match[0].trim();
      const startsSentence = match.index === 0;
      const candidate = cleanPhrase(phrase, startsSentence);
      if (!candidate) continue;

      const key = candidate.toLowerCase();
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { display: candidate, count: 1 });
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display))
    .slice(0, limit)
    .map(({ display, count }) => ({ name: display, count }));
}

/** Just the names, for use as a character-list fallback. */
export function properNounNames(text: string, limit = 12): string[] {
  return extractProperNouns(text, limit).map((entry) => entry.name);
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function cleanPhrase(phrase: string, startsSentence: boolean): string | null {
  const words = phrase.split(/\s+/);

  // A single capitalised word at the start of a sentence is usually just
  // sentence case ("Later, ...") rather than a name.
  if (startsSentence && words.length === 1) {
    if (STOPWORDS.has(stripPunctuation(words[0]!).toLowerCase())) return null;
  }

  // Drop leading stopwords ("The Buendia family" -> "Buendia family").
  while (words.length > 0 && STOPWORDS.has(stripPunctuation(words[0]!).toLowerCase())) {
    words.shift();
  }
  // ...and trailing ones, which a greedy match picks up.
  while (words.length > 0 && STOPWORDS.has(stripPunctuation(words[words.length - 1]!).toLowerCase())) {
    words.pop();
  }
  if (words.length === 0) return null;

  const cleaned = stripPunctuation(words.join(" "));
  if (cleaned.length < 3) return null;
  if (STOPWORDS.has(cleaned.toLowerCase())) return null;
  // A bare honorific with nothing after it is not a name.
  if (words.length === 1 && TITLES.has(cleaned.toLowerCase().replace(/\.$/, ""))) return null;

  return cleaned;
}

function stripPunctuation(value: string): string {
  return value.replace(/^[^\w\u00C0-\u024F]+|[^\w'\u2019\u00C0-\u024F-]+$/g, "");
}

/**
 * Does `answer` actually appear in the supplied text or name list?
 *
 * Deliberately lenient about case, accents and surrounding punctuation, and
 * strict about everything else: this is the check that catches a hallucinated
 * answer, so it must not be satisfiable by a near-miss.
 */
export function appearsInSource(answer: string, sources: string[]): boolean {
  const needle = normaliseForMatch(answer);
  if (!needle) return false;
  return sources.some((source) => normaliseForMatch(source).includes(needle));
}

export function normaliseForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2019']/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
