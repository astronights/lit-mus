import { fetchJson } from "@/lib/http";

const ENTITY_API = "https://www.wikidata.org/w/api.php";
export const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";

/** P674 = "characters". */
const CHARACTERS_PROPERTY = "P674";

export type WikidataResult = {
  characters: string[];
  /** English Wikipedia article title from the entity's sitelinks, if any. */
  enwikiTitle: string | null;
};

type EntitiesResponse = {
  entities?: Record<
    string,
    {
      labels?: Record<string, { value?: string }>;
      sitelinks?: Record<string, { title?: string }>;
      claims?: Record<
        string,
        Array<{ mainsnak?: { datavalue?: { value?: { id?: string } } } }>
      >;
    }
  >;
};

/**
 * Character list plus the enwiki sitelink for a book entity.
 *
 * Coverage is good for prizewinners and classics and patchy elsewhere -- an
 * empty list is expected, not an error, and the caller falls back to proper
 * nouns from the plot text.
 */
export async function fetchWikidata(wikidataId: string): Promise<WikidataResult> {
  const entity = await fetchEntities([wikidataId]);
  const book = entity.entities?.[wikidataId];
  if (!book) return { characters: [], enwikiTitle: null };

  const enwikiTitle = book.sitelinks?.enwiki?.title ?? null;

  const characterIds = (book.claims?.[CHARACTERS_PROPERTY] ?? [])
    .map((claim) => claim.mainsnak?.datavalue?.value?.id)
    .filter((id): id is string => Boolean(id));

  if (characterIds.length === 0) return { characters: [], enwikiTitle };

  // Wikidata accepts up to 50 ids per call; more characters than that would be
  // noise on a quiz card anyway.
  const labelData = await fetchEntities(characterIds.slice(0, 50), "labels");
  const characters = characterIds
    .map((id) => labelData.entities?.[id]?.labels?.en?.value)
    .filter((name): name is string => Boolean(name));

  return { characters, enwikiTitle };
}

async function fetchEntities(
  ids: string[],
  props = "claims|sitelinks|labels",
): Promise<EntitiesResponse> {
  const params = new URLSearchParams({
    action: "wbgetentities",
    format: "json",
    ids: ids.join("|"),
    props,
    languages: "en",
    sitefilter: "enwiki",
    origin: "*",
  });
  return fetchJson<EntitiesResponse>(`${ENTITY_API}?${params.toString()}`);
}

export type SparqlBinding = Record<string, { value: string; type: string }>;

/** Run a SPARQL query against the public endpoint (used by the seed job). */
export async function runSparql(query: string, timeoutMs = 60_000): Promise<SparqlBinding[]> {
  const response = await fetchJson<{ results?: { bindings?: SparqlBinding[] } }>(
    `${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`,
    { timeoutMs, headers: { accept: "application/sparql-results+json" } },
  );
  return response.results?.bindings ?? [];
}

/** `http://www.wikidata.org/entity/Q1234` -> `Q1234`. */
export function qidFromUri(uri: string): string {
  return uri.split("/").pop() ?? uri;
}
