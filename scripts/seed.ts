/**
 * Bulk seed job. Not in the request path.
 *
 *   npm run seed                       # every enabled source
 *   SEED_SOURCES=booker npm run seed   # one source
 *   npm run seed -- --dry-run          # fetch and count, write nothing
 *
 * Safe to re-run: books upsert on wikidata_id and categories are only ever
 * added, so a second run of the same sources changes nothing.
 */
// Must stay first: loads .env.local before any module reads process.env.
import "@/lib/env-init";

import { runSeed } from "@/lib/seed";
import { enabledSources } from "@/lib/seed-sources";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const sources = enabledSources();

  if (sources.length === 0) {
    console.error("No sources enabled. Check SEED_SOURCES or src/lib/seed-sources.ts.");
    process.exit(1);
  }

  console.log(
    `Seeding ${sources.length} source(s): ${sources.map((s) => s.id).join(", ")}` +
      (dryRun ? " [dry run]" : ""),
  );

  const started = Date.now();
  const reports = await runSeed({ sources, dryRun, onProgress: (m) => console.log(m) });

  console.log("\n--- summary ---");
  for (const report of reports) {
    if (report.error) {
      console.log(`${report.sourceId.padEnd(24)} FAILED: ${report.error}`);
      continue;
    }
    console.log(
      `${report.sourceId.padEnd(24)} fetched ${String(report.fetched).padStart(5)}` +
        `  new ${String(report.inserted).padStart(5)}` +
        `  tagged ${String(report.linked).padStart(5)}`,
    );
  }
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  if (reports.some((report) => report.error)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
