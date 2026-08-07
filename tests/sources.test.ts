import { describe, expect, it } from "vitest";

import { appearsInSource, properNounNames } from "@/lib/proper-nouns";
import {
  composeSourceDocument,
  extractContextSections,
  extractPlotSection,
  splitSections,
  toShortBlurb,
} from "@/lib/sources/wikipedia";
import { dedupe } from "@/lib/seed-rows";

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

describe("extractContextSections", () => {
  it("keeps the lead and the about-the-work sections", () => {
    const context = extractContextSections(EXTRACT);

    expect(context).toContain("1877 novel");
    // The legacy fact the whole question style depends on.
    expect(context).toContain("checkrein");
  });

  it("leaves the plot out, since that is fetched separately", () => {
    expect(extractContextSections(EXTRACT)).not.toContain("Squire Gordon");
  });

  it("excludes adaptations, which generate questions about films not books", () => {
    expect(extractContextSections(EXTRACT)).not.toContain("film versions");
  });
});

describe("composeSourceDocument", () => {
  it("labels both halves so the model can tell a legacy fact from a plot fact", () => {
    const document = composeSourceDocument(
      extractPlotSection(EXTRACT).text,
      extractContextSections(EXTRACT),
    );

    expect(document).toContain("== About the work ==");
    expect(document).toContain("== Plot ==");
    expect(document.indexOf("== About the work ==")).toBeLessThan(document.indexOf("== Plot =="));
    expect(document).toContain("checkrein");
    expect(document).toContain("Squire Gordon");
  });

  it("omits a half that is empty rather than leaving a bare heading", () => {
    expect(composeSourceDocument("", "Some background.")).toBe("== About the work ==\nSome background.");
    expect(composeSourceDocument("", "")).toBe("");
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
