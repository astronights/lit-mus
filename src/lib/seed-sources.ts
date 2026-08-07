/**
 * Seed sources (Section 4a).
 *
 * Seeding writes title / author / wikidata_id / category and nothing else --
 * no plot, no characters, no Gemini call. An unopened book costs one row, so
 * the list can afford to be generous.
 *
 * Phase 2 is literally "flip `enabled` to true and re-run": the job upserts on
 * `wikidata_id` and only ever adds category tags, so a book appearing in both
 * an old and a new source just gains a category. No migration, no dedupe pass,
 * no re-hydration of books already opened.
 *
 * Prizes are resolved by English label rather than by hard-coded QID. It costs
 * a little query time and buys readability: `wd:Q157811` is unverifiable by
 * eye, whereas a wrong label shows up immediately as a zero-row source in
 * `npm run check:sources`.
 */

export type SeedSourceKind = "sparql" | "file";

export type SeedSource = {
  /** Stable key. Also the category slug, and stored as `categories.seed_source`. */
  id: string;
  name: string;
  type: "award" | "list" | "region" | "genre";
  kind: SeedSourceKind;
  enabled: boolean;
  /** Roughly how many titles to expect, for sanity-checking a run. */
  expected: string;
  /** SPARQL text for `kind: "sparql"`. Must bind ?book, ?bookLabel, ?authorLabel. */
  query?: string;
  /** Path (relative to repo root) of a TSV for `kind: "file"`. */
  file?: string;
  /** Used when `file` is absent, so the source works on a fresh clone. */
  sampleFile?: string;
  notes?: string;
};

/** Shared preamble: label service, and the bindings the seed job expects. */
function prizeQuery(prizeLabel: string, { includeNominees = false } = {}): string {
  const nominee = includeNominees
    ? `
    UNION
    { ?book wdt:P1411 ?prize . }`
    : "";

  return `
SELECT DISTINCT ?book ?bookLabel ?authorLabel ?year WHERE {
  ?prize rdfs:label "${prizeLabel}"@en .
  { ?book wdt:P166 ?prize . }${nominee}
  OPTIONAL { ?book wdt:P50 ?author . }
  OPTIONAL { ?book wdt:P577 ?published . BIND(YEAR(?published) AS ?year) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`.trim();
}

export const SEED_SOURCES: SeedSource[] = [
  /* ---------------------------------------------------------------- Phase 1 */
  {
    id: "booker",
    name: "Booker Prize",
    type: "award",
    kind: "sparql",
    enabled: true,
    expected: "~350 (winners + shortlist)",
    query: prizeQuery("Booker Prize", { includeNominees: true }),
    notes: "Extremely quiz-dense. P1411 (nominated for) pulls in the shortlists.",
  },
  {
    id: "international-booker",
    name: "International Booker Prize",
    type: "award",
    kind: "sparql",
    enabled: true,
    expected: "~20",
    query: prizeQuery("International Booker Prize", { includeNominees: true }),
    notes: "Small but high-value for world-literature coverage.",
  },
  {
    id: "pulitzer-fiction",
    name: "Pulitzer Prize for Fiction",
    type: "award",
    kind: "sparql",
    enabled: true,
    expected: "~95",
    query: prizeQuery("Pulitzer Prize for Fiction"),
  },
  {
    id: "nobel-notable-works",
    name: "Nobel Laureate Works",
    type: "award",
    kind: "sparql",
    enabled: true,
    expected: "~250",
    // The prize goes to the writer, not the book, so this walks laureates ->
    // P800 (notable work) rather than looking for books with P166.
    query: `
SELECT DISTINCT ?book ?bookLabel ?authorLabel ?year WHERE {
  ?prize rdfs:label "Nobel Prize in Literature"@en .
  ?author wdt:P166 ?prize .
  ?author wdt:P800 ?book .
  OPTIONAL { ?book wdt:P577 ?published . BIND(YEAR(?published) AS ?year) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`.trim(),
  },
  {
    id: "widely-translated",
    name: "Widely Translated Classics",
    type: "list",
    kind: "sparql",
    enabled: true,
    expected: "~1,000-2,000 (tune the sitelink threshold)",
    // The canon problem: prize queries never find Black Beauty. Sitelink count
    // is a decent proxy for "famous enough to be quizzed" -- a book with
    // articles in 25 languages is, by definition, one people around the world
    // have heard of, and it skews far less Anglophone than a curated list.
    query: `
SELECT ?book ?bookLabel ?authorLabel ?year (COUNT(DISTINCT ?sitelink) AS ?links) WHERE {
  ?book wdt:P31 wd:Q7725634 .
  ?book wdt:P50 ?author .
  ?sitelink schema:about ?book .
  OPTIONAL { ?book wdt:P577 ?published . BIND(YEAR(?published) AS ?year) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?book ?bookLabel ?authorLabel ?year
HAVING (COUNT(DISTINCT ?sitelink) >= 25)
ORDER BY DESC(?links)`.trim(),
    notes:
      "Heaviest query by far -- raise the HAVING threshold if the endpoint times out. " +
      "Q7725634 is 'literary work'.",
  },
  {
    id: "1001-books",
    name: "1001 Books",
    type: "list",
    kind: "file",
    enabled: true,
    expected: "~1,300 with the full list; a sample ships in the repo",
    file: "data/1001-books.tsv",
    sampleFile: "data/1001-books.sample.tsv",
    notes:
      "Wikidata does not model this list, so it is file-driven: a TSV of " +
      "'title<TAB>author' lines. data/1001-books.sample.tsv ships as a starter; " +
      "drop the full list in as data/1001-books.tsv and re-run.",
  },

  /* ---------------------------------------------------------------- Phase 2 */
  /* Flip `enabled` and re-run the seed job. Nothing else needs to change. */
  {
    id: "womens-prize",
    name: "Women's Prize for Fiction",
    type: "award",
    kind: "sparql",
    enabled: false,
    expected: "~30 winners, ~180 with shortlists",
    query: prizeQuery("Women's Prize for Fiction", { includeNominees: true }),
  },
  {
    id: "national-book-award",
    name: "National Book Award for Fiction",
    type: "award",
    kind: "sparql",
    enabled: false,
    expected: "~75",
    query: prizeQuery("National Book Award for Fiction"),
  },
  {
    id: "goncourt",
    name: "Prix Goncourt",
    type: "award",
    kind: "sparql",
    enabled: false,
    expected: "~120",
    query: prizeQuery("Prix Goncourt"),
  },
  {
    id: "cervantes",
    name: "Premio Cervantes",
    type: "award",
    kind: "sparql",
    enabled: false,
    expected: "~50 (awarded to authors; walks P800)",
    query: `
SELECT DISTINCT ?book ?bookLabel ?authorLabel ?year WHERE {
  ?prize rdfs:label "Miguel de Cervantes Prize"@en .
  ?author wdt:P166 ?prize .
  ?author wdt:P800 ?book .
  OPTIONAL { ?book wdt:P577 ?published . BIND(YEAR(?published) AS ?year) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`.trim(),
  },
  {
    id: "akutagawa",
    name: "Akutagawa Prize",
    type: "award",
    kind: "sparql",
    enabled: false,
    expected: "~170",
    query: prizeQuery("Akutagawa Prize"),
  },
  {
    id: "caine-prize",
    name: "Caine Prize",
    type: "region",
    kind: "sparql",
    enabled: false,
    expected: "~25 (short fiction; coverage is thin)",
    query: prizeQuery("Caine Prize for African Writing"),
  },
  {
    id: "jcb-prize",
    name: "JCB Prize for Literature",
    type: "region",
    kind: "sparql",
    enabled: false,
    expected: "~10",
    query: prizeQuery("JCB Prize for Literature", { includeNominees: true }),
  },
  {
    id: "dsc-prize",
    name: "DSC Prize for South Asian Literature",
    type: "region",
    kind: "sparql",
    enabled: false,
    expected: "~15",
    query: prizeQuery("DSC Prize for South Asian Literature", { includeNominees: true }),
  },
];

/**
 * Sources to run. `SEED_SOURCES` env var narrows to a comma-separated subset
 * (handy for re-running one source); otherwise every enabled source runs.
 */
export function enabledSources(filter = process.env.SEED_SOURCES): SeedSource[] {
  const wanted = filter
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (wanted && wanted.length > 0) {
    return SEED_SOURCES.filter((source) => wanted.includes(source.id));
  }
  return SEED_SOURCES.filter((source) => source.enabled);
}
