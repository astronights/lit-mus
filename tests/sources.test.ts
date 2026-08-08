import { describe, expect, it } from "vitest";

import { appearsInSource, properNounNames } from "@/lib/proper-nouns";
import {
  composeSourceDocument,
  extractContextSections,
  extractLead,
  extractPlotSection,
  splitSections,
  toShortBlurb,
} from "@/lib/sources/wikipedia";
import { dedupe } from "@/lib/seed-rows";
import { SEED_SOURCES } from "@/lib/seed-sources";

const EXTRACT = `Black Beauty is an 1877 novel by the English author Anna Sewell.

== Plot ==
Black Beauty is a handsome colt raised at Farmer Grey's estate. He is sold to Squire Gordon,
where he meets Ginger, a chestnut mare with a bitter past. After an accident he is sold again,
eventually pulling a London cab for Jerry Barker.

== Reception ==
The novel sold fifty million copies and its portrayal of working animals is said to have been
instrumental in the abolition of the checkrein, or bearing rein.

== Adaptations ==
There have been several film versions.`;

describe("extractPlotSection", () => {
  it("pulls the Plot section rather than the whole article", () => {
    const result = extractPlotSection(EXTRACT);

    expect(result.usedFallback).toBe(false);
    expect(result.text).toContain("Squire Gordon");
    expect(result.text).not.toContain("fifty million copies");
  });

  it("falls back to the lead when there is no plot-ish section", () => {
    const result = extractPlotSection(
      "A very short article about a book that nobody has expanded yet, with enough words in the lead to be worth keeping around for grounding.",
    );

    expect(result.usedFallback).toBe(true);
    expect(result.text).toContain("very short article");
  });

  it("ignores a plot heading with almost nothing under it", () => {
    const thin = "Lead paragraph with some actual content in it.\n\n== Plot ==\nTBD.";
    expect(extractPlotSection(thin).usedFallback).toBe(true);
  });

  it("splits nested headings without losing the top-level ones", () => {
    const { sections } = splitSections(EXTRACT);
    expect(sections.map((section) => section.heading)).toEqual([
      "Plot",
      "Reception",
      "Adaptations",
    ]);
  });
});

describe("extractLead", () => {
  it("takes the paragraphs before the first heading", () => {
    const lead = extractLead(EXTRACT);

    expect(lead).toContain("1877 novel");
    expect(lead).not.toContain("Squire Gordon");
  });

  it("cuts a long lead on a sentence boundary", () => {
    const long = `${"A sentence about the book. ".repeat(80)}\n\n== Plot ==\nStuff.`;
    const lead = extractLead(long, 200);

    expect(lead.length).toBeLessThanOrEqual(200);
    expect(lead.endsWith(".")).toBe(true);
  });
});

describe("extractContextSections", () => {
  it("keeps the about-the-work sections", () => {
    const context = extractContextSections(EXTRACT);

    expect(context).toContain("Reception");
    // The legacy fact that the whole question style depends on.
    expect(context).toContain("checkrein");
  });

  it("leaves the plot out, since that is carried separately", () => {
    expect(extractContextSections(EXTRACT)).not.toContain("Squire Gordon");
  });

  it("excludes adaptations, which would generate questions about films", () => {
    expect(extractContextSections(EXTRACT)).not.toContain("film versions");
  });

  it("caps itself so a huge reception section cannot crowd out the plot", () => {
    const huge = `Lead.\n\n== Reception ==\n${"Critics praised it. ".repeat(2000)}`;
    expect(extractContextSections(huge, 500).length).toBeLessThanOrEqual(501);
  });
});

describe("composeSourceDocument", () => {
  it("carries the lead, the about-the-work sections and the plot", () => {
    const document = composeSourceDocument(
      extractPlotSection(EXTRACT).text,
      extractLead(EXTRACT),
      extractContextSections(EXTRACT),
    );

    expect(document).toContain("== Lead ==");
    expect(document).toContain("== About the work ==");
    expect(document).toContain("== Plot ==");
    expect(document).toContain("checkrein");
    expect(document).toContain("Squire Gordon");
  });

  it("puts the plot last, so it is what gets truncated first", () => {
    const document = composeSourceDocument(
      extractPlotSection(EXTRACT).text,
      extractLead(EXTRACT),
      extractContextSections(EXTRACT),
    );

    expect(document.indexOf("== Lead ==")).toBeLessThan(document.indexOf("== About the work =="));
    expect(document.indexOf("== About the work ==")).toBeLessThan(document.indexOf("== Plot =="));
  });

  it("omits a part that is empty rather than leaving a bare heading", () => {
    expect(composeSourceDocument("", "Some lead.", "")).toBe("== Lead ==\nSome lead.");
    expect(composeSourceDocument("", "", "")).toBe("");
  });
});

describe("toShortBlurb", () => {
  it("cuts on a sentence boundary, not mid-clause", () => {
    const blurb = toShortBlurb(extractPlotSection(EXTRACT).text, 2);

    expect(blurb.endsWith(".")).toBe(true);
    expect(blurb).toContain("Farmer Grey");
  });

  it("does not treat an abbreviation's period as a sentence end", () => {
    const blurb = toShortBlurb("Mr. Rochester keeps a secret. Jane leaves Thornfield.", 1);
    expect(blurb).toBe("Mr. Rochester keeps a secret.");
  });

  it("returns empty for empty input", () => {
    expect(toShortBlurb("")).toBe("");
  });
});

describe("properNounNames", () => {
  it("finds character names in the plot text", () => {
    const names = properNounNames(extractPlotSection(EXTRACT).text);

    expect(names).toContain("Ginger");
    expect(names).toContain("Jerry Barker");
  });

  it("does not mistake a sentence-initial common word for a name", () => {
    const names = properNounNames("After the accident he was sold. Later he pulled a cab.");
    expect(names).not.toContain("After");
    expect(names).not.toContain("Later");
  });
});

describe("appearsInSource", () => {
  const sources = [EXTRACT, "Ginger"];

  it("matches ignoring case and punctuation", () => {
    expect(appearsInSource("squire gordon", sources)).toBe(true);
  });

  it("matches a name supplied only by the character list", () => {
    expect(appearsInSource("Ginger", sources)).toBe(true);
  });

  it("rejects an invented answer", () => {
    expect(appearsInSource("Captain Ahab", sources)).toBe(false);
  });

  it("rejects an empty answer", () => {
    expect(appearsInSource("   ", sources)).toBe(false);
  });
});

describe("seed dedupe", () => {
  it("collapses rows sharing a wikidata id", () => {
    const rows = dedupe([
      { title: "Beloved", author: "Toni Morrison", wikidataId: "Q1", year: null },
      { title: "Beloved", author: "T. Morrison", wikidataId: "Q1", year: 1987 },
    ]);

    expect(rows).toHaveLength(1);
    // The richer row wins: SPARQL emits one binding per author, and a row with
    // a year beats one without.
    expect(rows[0]!.year).toBe(1987);
  });

  it("collapses file rows on title and author when there is no id", () => {
    const rows = dedupe([
      { title: "Black Beauty", author: "Anna Sewell", wikidataId: null, year: null },
      { title: "black beauty", author: "anna sewell", wikidataId: null, year: null },
      { title: "Black Beauty", author: "Someone Else", wikidataId: null, year: null },
    ]);

    expect(rows).toHaveLength(2);
  });
});

/**
 * The prize queries are the one part of seeding that cannot be unit-tested
 * against the live endpoint from here, so the guards that matter are asserted
 * on the query text itself.
 *
 * The bug being pinned: `P166` (award received) sits on the author as well as
 * on the work for a literary prize, so an unguarded query files novelists as
 * books. David Storey has "award received: Booker Prize" exactly as Saville
 * does, and Drill went on to ask a title riddle whose answer was a person.
 */
describe("prize seed queries", () => {
  const sparqlSources = SEED_SOURCES.filter((source) => source.kind === "sparql");

  it("covers every SPARQL source, enabled or not", () => {
    // Phase 2 sources are disabled, not absent. Flipping one on should not be
    // how this bug comes back.
    expect(sparqlSources.length).toBeGreaterThanOrEqual(8);
  });

  for (const source of sparqlSources) {
    describe(source.id, () => {
      it("cannot yield a person", () => {
        // Two honest ways to guarantee it: say what ?book must be, or say what
        // it must not be. `widely-translated` already pins P31 to literary
        // work, which is the stronger of the two -- it should not be made to
        // carry a redundant filter to satisfy this test.
        const excludesHumans = source.query!.includes("FILTER NOT EXISTS { ?book wdt:P31 wd:Q5 }");
        const pinnedToAWorkType = /\?book wdt:P31 wd:Q(?!5\b)\d+/.test(source.query!);

        expect(excludesHumans || pinnedToAWorkType).toBe(true);
      });

      it("requires an author rather than leaving P50 optional", () => {
        // The laureate-walk sources (?author wdt:P166 -> P800) establish
        // authorship through ?author instead, so they are exempt from the
        // direct P50 requirement -- but not from the Q5 filter above.
        const walksFromLaureate = source.query!.includes("?author wdt:P800 ?book");
        if (walksFromLaureate) return;

        expect(source.query).toContain("?book wdt:P50 ?author .");
        expect(source.query).not.toContain("OPTIONAL { ?book wdt:P50 ?author . }");
      });
    });
  }
});
