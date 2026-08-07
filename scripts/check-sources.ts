/**
 * Dry-run every seed source and report what it returns. No database needed.
 *
 *   npm run check:sources
 *   npm run check:sources -- --all      # include Phase 2 (disabled) sources
 *
 * Worth running before the first real seed: the SPARQL queries resolve prizes
 * by English label, so a renamed prize shows up here as a zero-row source
 * rather than as a silently missing category weeks later.
 */
import "dotenv/config";

import { fetchSource } from "@/lib/seed-rows";
import { SEED_SOURCES, enabledSources } from "@/lib/seed-sources";

async function main() {
  const all = process.argv.includes("--all");
  const sources = all ? SEED_SOURCES : enabledSources();

  let failures = 0;

  for (const source of sources) {
    const label = `${source.id}${source.enabled ? "" : " (phase 2)"}`;
    process.stdout.write(`${label.padEnd(32)} `);
    const started = Date.now();

    try {
      const rows = await fetchSource(source);
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      const sample = rows
        .slice(0, 3)
        .map((row) => row.title)
        .join(" | ");

      if (rows.length === 0) {
        failures += 1;
        console.log(`0 rows in ${elapsed}s  <-- expected ${source.expected}`);
      } else {
        console.log(`${String(rows.length).padStart(5)} rows in ${elapsed}s  ${sample}`);
      }
    } catch (error) {
      failures += 1;
      console.log(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures > 0) {
    console.log(`\n${failures} source(s) returned nothing or failed.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
