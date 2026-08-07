import { readFileSync } from "node:fs";
import path from "node:path";

import { qidFromUri, runSparql } from "@/lib/sources/wikidata";
import type { SeedSource } from "@/lib/seed-sources";

/**
 * Fetching and normalising seed rows.
 *
 * Deliberately free of database imports so `npm run check:sources` can dry-run
 * every source without a DATABASE_URL, and so the parsing logic is testable on
 * its own.
 */

export type SeedRow = {
  title: string;
  author: string | null;
  wikidataId: string | null;
  year: number | null;
};

export async function fetchSource(source: SeedSource): Promise<SeedRow[]> {
  if (source.kind === "sparql") {
    if (!source.query) throw new Error(`Source ${source.id} has no query`);
    const bindings = await runSparql(source.query);
    return bindings
      .map((binding) => ({
        title: binding.bookLabel?.value ?? "",
        author: binding.authorLabel?.value ?? null,
        wikidataId: binding.book?.value ? qidFromUri(binding.book.value) : null,
        year: binding.year?.value ? Number(binding.year.value) : null,
      }))
      // A missing label comes back as the raw QID; that is not a title.
      .filter((row) => row.title && !/^Q\d+$/.test(row.title));
  }

  if (!source.file) throw new Error(`Source ${source.id} has no file`);
  return readTsv(source.file);
}

/**
 * `title<TAB>author` per line. Blank lines and `#` comments are ignored, and a
 * missing file is a clear error rather than a silent zero-row source.
 */
export function readTsv(relativePath: string): SeedRow[] {
  const absolute = path.join(process.cwd(), relativePath);
  let contents: string;
  try {
    contents = readFileSync(absolute, "utf8");
  } catch {
    throw new Error(
      `Missing ${relativePath}. See data/1001-books.sample.tsv for the expected format.`,
    );
  }

  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [title, author] = line.split("\t");
      return {
        title: (title ?? "").trim(),
        author: author?.trim() || null,
        wikidataId: null,
        year: null,
      };
    })
    .filter((row) => row.title.length > 0);
}

/** Within one source: same QID, or same title+author, is the same book. */
export function dedupe(rows: SeedRow[]): SeedRow[] {
  const seen = new Map<string, SeedRow>();
  for (const row of rows) {
    const key = row.wikidataId ?? `${row.title.toLowerCase()}|${(row.author ?? "").toLowerCase()}`;
    const existing = seen.get(key);
    // Prefer the richer row: SPARQL returns one binding per author for
    // co-authored works, and one with a year beats one without.
    if (!existing || (!existing.year && row.year)) seen.set(key, row);
  }
  return [...seen.values()];
}
