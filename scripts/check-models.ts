/**
 * Ask Google which models this API key can actually use.
 *
 *   npm run check:models
 *   npm run check:models -- --all    # include embedding/vision-only models
 *
 * Worth running before setting GEMINI_MODEL. Model ids move faster than any
 * table we could keep in the repo -- the 3.x family switched to a dotted scheme
 * (gemini-3.1-flash-lite), names get dated suffixes, and preview ids are
 * retired on a schedule. An id that no longer exists 404s on *every* call,
 * which in the app looks like "generation is broken" rather than "one setting
 * is stale". This turns that into a five-second check.
 *
 * Note what this can and cannot tell you. The API lists models; it does not
 * expose your rate limits, which vary by project, region, account age and
 * whether billing is attached. For the actual numbers, see AI Studio.
 */
// Must stay first: loads .env.local before any module reads process.env.
import "@/lib/env-init";

import { resolveModel, scoreModel } from "@/lib/questions/gemini";

type ModelInfo = {
  name: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
};

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set. Add it to .env.local first.");
    process.exit(1);
  }

  const all = process.argv.includes("--all");

  const models: ModelInfo[] = [];
  let pageToken: string | undefined;

  // Paginated: the list is comfortably over one page now.
  do {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url, { headers: { "x-goog-api-key": apiKey } });
    if (!response.ok) {
      console.error(`ListModels failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
      process.exit(1);
    }

    const page = (await response.json()) as { models?: ModelInfo[]; nextPageToken?: string };
    models.push(...(page.models ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  const usable = all
    ? models
    : models.filter((model) => model.supportedGenerationMethods?.includes("generateContent"));

  usable.sort((a, b) => a.name.localeCompare(b.name));

  // What the app would actually call, given this key and this environment.
  const chosen = await resolveModel();
  const override = process.env.GEMINI_MODEL?.trim();

  let chosenFound = false;

  for (const model of usable) {
    // The API returns "models/gemini-x"; GEMINI_MODEL takes the bare id.
    const id = model.name.replace(/^models\//, "");
    const current = id === chosen;
    if (current) chosenFound = true;

    // The score is shown so the ranking is inspectable rather than magic: if
    // the pick looks wrong, the number says which rule decided it.
    const score = scoreModel(id);
    const rank = score >= 0 ? String(score).padStart(4) : "   -";

    console.log(`${current ? "->" : "  "} ${rank}  ${id.padEnd(42)} ${model.displayName ?? ""}`);
  }

  console.log(`\n${usable.length} model(s) support generateContent.`);
  console.log(
    override
      ? `GEMINI_MODEL is set to "${chosen}", so that is what the app calls.`
      : `No GEMINI_MODEL set; the app auto-selects "${chosen}".`,
  );

  if (!chosenFound) {
    console.log("\n  ^ NOT IN THE LIST ABOVE. Every generation call will 404 until it is.");
    if (override) console.log("    Unset GEMINI_MODEL to let the app pick for itself.");
    process.exit(1);
  }

  console.log("\nRate limits are not exposed by this API -- they vary by project and");
  console.log("region. Check AI Studio, then set GEMINI_MAX_REQUESTS_PER_DAY to match.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
