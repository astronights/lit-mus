import { fetchJson } from "@/lib/http";

const API = "https://en.wikipedia.org/w/api.php";

export type WikipediaResult = {
  /** Article title, kept so the attribution link can point at the source. */
  articleTitle: string;
  articleUrl: string;
  /** The Plot section if we found one, otherwise the article lead. */
  plotText: string;
  /**
   * The article lead -- the paragraphs before the first heading.
   *
   * Short, and the densest text on the page: year, prize, nationality, and
   * usually what the title refers to. That last one is most of a good riddle.
   */
  leadText: string;
  /**
   * The sections written *about* the work rather than inside it -- background,
   * themes, reception, legacy, influence.
   *
   * A heading list alone was tried and was not enough. The model knows the
   * canon well enough to do without this, but the contemporary translated
   * fiction this app exists to cover is exactly where its knowledge is thin,
   * and where an unanchored answer is most likely to be confidently wrong.
   * This text is the anchor, and it costs nothing extra to fetch -- the extract
   * call already returns the whole article.
   */
  contextText: string;
  /** True when we fell back to the lead because no plot-ish section existed. */
  usedFallback: boolean;
};

type QueryResponse = {
  query?: {
    search?: Array<{ title: string }>;
    pages?: Record<string, { title?: string; extract?: string; missing?: string }>;
  };
};

/**
 * Section headings that carry the plot, in preference order. Wikipedia is not
 * consistent here -- "Plot" for novels, "Synopsis" for older articles, and
 * "Plot summary" for most of the recent ones.
 */
const PLOT_HEADINGS = [
  "plot",
  "plot summary",
  "synopsis",
  "plot synopsis",
  "summary",
  "story",
  "content",
  "contents",
];

/**
 * Sections that discuss the work from outside it.
 *
 * Deliberately excludes "Adaptations" and "See also", which are mostly lists of
 * other titles and would generate questions about films rather than books.
 */
const CONTEXT_HEADING_PATTERN =
  /^(background|composition|writing|publication|publication history|themes?|style|analysis|interpretation|criticism|reception|critical reception|legacy|influence|impact|significance|historical context|context)\b/i;

/**
 * Fetch the plot text for an article.
 *
 * The design doc specified `explaintext` + `exsectionformat=plain`; we ask for
 * `exsectionformat=wiki` instead. Plain format strips the `==` markers, which
 * makes headings indistinguishable from ordinary lines -- with wiki format the
 * section boundaries are unambiguous, and we strip the markers ourselves after
 * slicing. Same output, far fewer mis-slices.
 */
export async function fetchWikipediaPlot(articleTitle: string): Promise<WikipediaResult> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "extracts",
    explaintext: "1",
    exsectionformat: "wiki",
    redirects: "1",
    titles: articleTitle,
    origin: "*",
  });

  const data = await fetchJson<{
    query?: { pages?: Array<{ title?: string; extract?: string; missing?: boolean }> };
  }>(`${API}?${params.toString()}`);

  const page = data.query?.pages?.[0];
  if (!page || page.missing || !page.extract) {
    throw new Error(`No Wikipedia extract for "${articleTitle}"`);
  }

  const resolvedTitle = page.title ?? articleTitle;
  const section = extractPlotSection(page.extract);

  return {
    articleTitle: resolvedTitle,
    articleUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(resolvedTitle.replace(/ /g, "_"))}`,
    plotText: section.text,
    leadText: extractLead(page.extract),
    contextText: extractContextSections(page.extract),
    usedFallback: section.usedFallback,
  };
}

/** The paragraphs before the first heading, capped to a couple of them. */
export function extractLead(extract: string, maxChars = 1_200): string {
  const lead = splitSections(extract).lead.replace(/\n{2,}/g, "\n").trim();
  if (lead.length <= maxChars) return lead;

  // Cut on a sentence boundary rather than mid-clause.
  const cut = lead.slice(0, maxChars);
  const lastStop = cut.lastIndexOf(". ");
  return lastStop > maxChars / 2 ? cut.slice(0, lastStop + 1) : `${cut.trimEnd()}…`;
}

/**
 * The "about the work" sections, with their headings kept so the model can see
 * what kind of fact it is reading.
 *
 * Capped separately from the plot so that an article with an enormous Reception
 * section cannot crowd the story out of the prompt.
 */
export function extractContextSections(extract: string, maxChars = 6_000): string {
  const parts: string[] = [];

  for (const section of splitSections(extract).sections) {
    if (!CONTEXT_HEADING_PATTERN.test(section.heading)) continue;
    const body = section.body.trim();
    if (body.length < 80) continue;
    parts.push(`## ${section.heading}\n${body}`);
  }

  const joined = parts.join("\n\n");
  return joined.length > maxChars ? `${joined.slice(0, maxChars).trimEnd()}…` : joined;
}

/** Resolve a title/author pair to an article title via Wikipedia search. */
export async function searchWikipediaArticle(
  title: string,
  author: string | null,
): Promise<string | null> {
  const query = author ? `${title} ${author} novel` : `${title} novel`;
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    list: "search",
    srsearch: query,
    srlimit: "1",
    origin: "*",
  });
  const data = await fetchJson<QueryResponse>(`${API}?${params.toString()}`);
  return data.query?.search?.[0]?.title ?? null;
}

type Section = { heading: string; body: string };

/**
 * Split a plain-text extract on `== Heading ==` lines. Only top-level (`==`)
 * and second-level (`===`) headings appear in extracts.
 */
export function splitSections(extract: string): { lead: string; sections: Section[] } {
  const lines = extract.split("\n");
  const headingPattern = /^\s*(={2,6})\s*(.+?)\s*\1\s*$/;

  let lead = "";
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    const match = headingPattern.exec(line);
    if (match) {
      if (current) sections.push(current);
      current = { heading: match[2]!.trim(), body: "" };
      continue;
    }
    if (current) current.body += `${line}\n`;
    else lead += `${line}\n`;
  }
  if (current) sections.push(current);

  return { lead: lead.trim(), sections };
}

export function extractPlotSection(extract: string): { text: string; usedFallback: boolean } {
  const { lead, sections } = splitSections(extract);

  for (const wanted of PLOT_HEADINGS) {
    const match = sections.find((section) => section.heading.toLowerCase() === wanted);
    if (match && match.body.trim().length > 120) {
      return { text: match.body.trim(), usedFallback: false };
    }
  }

  // Some articles bury it ("Plot and characters", "Plot summary and themes").
  const loose = sections.find(
    (section) =>
      /^(plot|synopsis|summary)\b/i.test(section.heading) && section.body.trim().length > 120,
  );
  if (loose) return { text: loose.body.trim(), usedFallback: false };

  return { text: lead, usedFallback: true };
}

/**
 * Trim raw extract text down to a card-sized blurb.
 *
 * Sentence-aware rather than a hard character cut, because a blurb ending
 * mid-clause reads like a bug. Abbreviations that end in a period ("Mr.",
 * "St.") are the usual trap, so those are excluded from sentence ends.
 */
export function toShortBlurb(text: string, maxSentences = 4, maxChars = 520): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  const sentences = cleaned.match(/[^.!?]+(?:[.!?]+(?:["')\]]+)?|$)/g) ?? [cleaned];

  const merged: string[] = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const previous = merged[merged.length - 1];
    if (previous && /\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|vs|etc|e\.g|i\.e)\.$/.test(previous)) {
      merged[merged.length - 1] = `${previous} ${sentence}`;
    } else {
      merged.push(sentence);
    }
  }

  let blurb = "";
  for (const sentence of merged.slice(0, maxSentences)) {
    if (blurb && `${blurb} ${sentence}`.length > maxChars) break;
    blurb = blurb ? `${blurb} ${sentence}` : sentence;
  }

  if (!blurb) blurb = merged[0] ?? cleaned;
  return blurb.length > maxChars ? `${blurb.slice(0, maxChars - 1).trimEnd()}…` : blurb;
}

/**
 * The document stored as `source_extract` and handed to the model.
 *
 * Lead, the "about the work" sections, then the plot -- in that order, because
 * the most quizzable material is at the top and the plot is the part that gets
 * truncated first if anything has to go.
 */
export function composeSourceDocument(
  plotText: string,
  leadText: string,
  contextText: string,
): string {
  const parts: string[] = [];
  if (leadText.trim()) parts.push(`== Lead ==\n${leadText.trim()}`);
  if (contextText.trim()) parts.push(`== About the work ==\n${contextText.trim()}`);
  if (plotText.trim()) parts.push(`== Plot ==\n${plotText.trim()}`);
  return parts.join("\n\n");
}
