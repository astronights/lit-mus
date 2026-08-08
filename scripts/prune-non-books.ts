/**
 * Find and remove seeded rows that are not books.
 *
 *   npm run prune:non-books           # dry run: list what would go
 *   npm run prune:non-books -- --yes  # actually delete
 *
 * Why this exists: the prize queries matched on `P166` (award received), which
 * for a literary prize sits on the *author* as much as on the work -- David
 * Storey carries "award received: Booker Prize" exactly as Saville does. So
 * novelists were filed as books, and Drill cheerfully wrote a title riddle
 * whose answer was a person. The query is fixed, but a re-seed only upserts;
 * it never removes what is already there.
 *
 * The test is Wikidata's own, not a guess from the strings: ask which of our
 * stored QIDs are instances of human (Q5). Heuristics like "title equals
 * author" would miss the rows where the author label came back empty, and
 * would delete a real book called after its author.
 *
 * Deletes cascade to questions, plot blurbs, category links and drill state.
 */
// Must stay first: loads .env.local before any module reads process.env.
import "@/lib/env-init";

import { inArray, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { books } from "@/db/schema";
import { qidFromUri, runSparql } from "@/lib/sources/wikidata";

/** Keep each VALUES clause to a size WDQS answers without complaint. */
const BATCH = 200;

async function humansAmong(qids: string[]): Promise<Set<string>> {
  const humans = new Set<string>();

  for (let start = 0; start < qids.length; start += BATCH) {
    const batch = qids.slice(start, start + BATCH);
    const values = batch.map((qid) => `wd:${qid}`).join(" ");

    const bindings = await runSparql(`
SELECT ?item WHERE {
  VALUES ?item { ${values} }
  ?item wdt:P31 wd:Q5 .
}`);

    for (const binding of bindings) {
      const qid = binding.item?.value ? qidFromUri(binding.item.value) : null;
      if (qid) humans.add(qid);
    }

    process.stdout.write(`  checked ${Math.min(start + BATCH, qids.length)}/${qids.length}\r`);
  }

  return humans;
}

async function main() {
  const confirmed = process.argv.includes("--yes");

  const rows = await db
    .select({ id: books.id, title: books.title, author: books.author, qid: books.wikidataId })
    .from(books)
    .where(isNotNull(books.wikidataId));

  console.log(`${rows.length} seeded book(s) with a Wikidata id.\n`);
  if (rows.length === 0) return;

  const humans = await humansAmong(rows.map((row) => row.qid!));
  const bad = rows.filter((row) => humans.has(row.qid!));

  console.log(`\n${bad.length} row(s) are people, not books.\n`);
  if (bad.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  for (const row of bad) {
    console.log(`  ${String(row.id).padStart(6)}  ${row.title}  (${row.qid})`);
  }

  if (!confirmed) {
    console.log("\nDry run. Re-run with --yes to delete these and everything hanging off them.");
    return;
  }

  // Chunked: one enormous IN list is the other way to make Neon unhappy.
  for (let start = 0; start < bad.length; start += BATCH) {
    const ids = bad.slice(start, start + BATCH).map((row) => row.id);
    await db.delete(books).where(inArray(books.id, ids));
  }

  console.log(`\nDeleted ${bad.length} row(s). Questions and drill state went with them.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
