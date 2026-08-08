import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { answerGivenAwayBy, riddleLeak } from "@/lib/questions/validate";
import { normaliseForMatch } from "@/lib/proper-nouns";

/**
 * The prompt's own examples must obey the prompt's own rules.
 *
 * Few-shot examples are the strongest lever on output, which cuts both ways: an
 * example that breaks a rule teaches the model to break it, silently and
 * permanently, since questions are generated once. Two of these checks have
 * already caught real mistakes -- an early Black Beauty example named the
 * bearing rein in the riddle and then asked for it, and an Exit West draft
 * listed Mykonos in the riddle and then asked for that.
 *
 * This parses the shipped prompt rather than a copy, so editing the file is
 * what runs the checks.
 */

type Example = {
  heading: string;
  title: string;
  author: string;
  riddle: { question: string; answer: string } | null;
  details: Array<{ question: string; answer: string }>;
};

function loadExamples(): Example[] {
  const file = readFileSync(
    path.join(process.cwd(), "prompts", "question-generation.md"),
    "utf8",
  );

  const examples: Example[] = [];
  const blocks = file.split(/^### Example /m).slice(1);

  for (const block of blocks) {
    const heading = block.split("\n")[0]!.trim();
    const title = /^Title:\s*(.+)$/m.exec(block)?.[1]?.trim();
    const author = /^Author:\s*(.+)$/m.exec(block)?.[1]?.trim();
    const json = /```json\n([\s\S]*?)```/.exec(block)?.[1];
    if (!title || !author || !json) continue;

    const parsed = JSON.parse(json) as {
      title_riddle: { question: string; answer: string } | null;
      detail_questions: Array<{ question: string; answer: string }>;
    };

    examples.push({
      heading,
      title,
      author,
      riddle: parsed.title_riddle,
      details: parsed.detail_questions ?? [],
    });
  }

  return examples;
}

const examples = loadExamples();

describe("prompt examples", () => {
  it("parses every example in the file", () => {
    // Guards against the parser silently matching nothing after a reformat.
    expect(examples.length).toBeGreaterThanOrEqual(5);
  });

  it("teaches all four wells plus the empty return", () => {
    const headings = examples.map((example) => example.heading.toLowerCase()).join(" | ");

    expect(headings).toContain("real-world effect");
    expect(headings).toContain("title counts");
    expect(headings).toContain("vague versus specific");
    expect(headings).toContain("came to be written");
    expect(headings).toContain("nothing recognisable");
  });

  for (const example of examples) {
    describe(example.title, () => {
      it("has a riddle that does not contain its own answer", () => {
        if (!example.riddle) return;

        // No character list here, so this checks title, distinctive title words
        // and the author's surname -- the parts that are checkable from the file.
        expect(
          riddleLeak(example.riddle.question, {
            title: example.title,
            author: example.author,
            characterNames: [],
          }),
        ).toBeNull();
      });

      it("answers the riddle with the exact title", () => {
        if (!example.riddle) return;
        expect(example.riddle.answer).toBe(example.title);
      });

      it("keeps the riddle under the stated length", () => {
        if (!example.riddle) return;
        const words = example.riddle.question.trim().split(/\s+/).length;
        // The prompt says two sentences and about 40 words; allow a little slack
        // so a one-word edit does not fail the suite.
        expect(words).toBeLessThanOrEqual(45);
      });

      it("never asks for something the riddle already gave away", () => {
        if (!example.riddle) return;

        for (const detail of example.details) {
          expect(
            answerGivenAwayBy(normaliseForMatch(detail.answer), example.riddle.question),
          ).toBe(false);
        }
      });

      it("keeps answers to a name or short phrase", () => {
        for (const detail of example.details) {
          expect(detail.answer.trim().split(/\s+/).length).toBeLessThanOrEqual(5);
        }
      });

      it("asks at most two detail questions", () => {
        expect(example.details.length).toBeLessThanOrEqual(2);
      });
    });
  }
});
