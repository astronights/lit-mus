import { fetchJson } from "@/lib/http";

export type OpenLibraryResult = {
  coverUrl: string | null;
  openLibraryId: string | null;
  firstPublishYear: number | null;
  isbn: string | null;
};

type SearchResponse = {
  docs?: Array<{
    key?: string;
    title?: string;
    author_name?: string[];
    first_publish_year?: number;
    cover_i?: number;
    isbn?: string[];
  }>;
};

const SEARCH_FIELDS = "key,title,author_name,first_publish_year,cover_i,isbn";

/** Cover, ISBN and publication year for a title/author pair. */
export async function fetchOpenLibrary(
  title: string,
  author: string | null,
): Promise<OpenLibraryResult> {
  const params = new URLSearchParams({
    title,
    limit: "5",
    fields: SEARCH_FIELDS,
  });
  if (author) params.set("author", author);

  const data = await fetchJson<SearchResponse>(
    `https://openlibrary.org/search.json?${params.toString()}`,
  );

  const doc = pickBestMatch(data.docs ?? [], title);
  if (!doc) {
    return { coverUrl: null, openLibraryId: null, firstPublishYear: null, isbn: null };
  }

  return {
    coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null,
    openLibraryId: doc.key ? doc.key.replace(/^\/works\//, "") : null,
    firstPublishYear: doc.first_publish_year ?? null,
    isbn: doc.isbn?.[0] ?? null,
  };
}

/**
 * Open Library's relevance ordering is loose, and a search for a well-known
 * title happily returns study guides and abridgements above the novel. Prefer
 * an exact title match, and among those the one that actually has a cover.
 */
function pickBestMatch<T extends { title?: string; cover_i?: number }>(
  docs: T[],
  title: string,
): T | undefined {
  if (docs.length === 0) return undefined;
  const normalised = normalise(title);
  const exact = docs.filter((doc) => normalise(doc.title ?? "") === normalised);
  const pool = exact.length > 0 ? exact : docs;
  return pool.find((doc) => doc.cover_i) ?? pool[0];
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
