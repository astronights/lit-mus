import { describe, expect, it } from "vitest";

import {
  QuestionParseError,
  parseGenerationResponse,
  riddleLeak,
  validateQuestions,
} from "@/lib/questions/validate";

const PLOT = `
Maali Almeida, a war photographer, wakes up dead in a celestial visa office in Colombo.
He is given seven moons to contact Jaki and DD and lead them to a hidden box of photographs
that could shake the country.
`;

const CONTEXT = {
  title: "The Seven Moons of Maali Almeida",
  author: "Shehan Karunatilaka",
  plotText: PLOT,
  characterNames: ["Maali Almeida", "Jaki", "DD"],
};

describe("parseGenerationResponse", () => {
  it("parses plain JSON", () => {
    expect(parseGenerationResponse('{"title_riddle": null}')).toEqual({ title_riddle: null });
  });

  it("strips a stray markdown fence", () => {
    const raw = '```json\n{"detail_questions": []}\n```';
    expect(parseGenerationResponse(raw)).toEqual({ detail_questions: [] });
  });

  it("throws a typed error on malformed JSON so the caller can retry once", () => {
    expect(() => parseGenerationResponse("not json at all")).toThrow(QuestionParseError);
  });
});

describe("riddleLeak", () => {
  it("accepts an oblique clue", () => {
    expect(
      riddleLeak(
        "A war photographer wakes up dead and is given a week to solve his own murder.",
        CONTEXT,
      ),
    ).toBeNull();
  });

  it("catches the full title", () => {
    expect(riddleLeak("Read The Seven Moons of Maali Almeida.", CONTEXT)).toBe("title");
  });

  it("catches a distinctive title word", () => {
    // "seven moons" without the rest is still the answer.
    expect(riddleLeak("A dead man gets seven moons to find his killer.", CONTEXT)).toContain(
      "title word",
    );
  });

  it("catches the author's surname", () => {
    expect(riddleLeak("A novel by Karunatilaka about the afterlife.", CONTEXT)).toBe("author");
  });

  it("catches a character name", () => {
    expect(riddleLeak("A photographer who must reach Jaki from beyond.", CONTEXT)).toContain(
      "character",
    );
  });
});

describe("validateQuestions", () => {
  it("keeps grounded detail answers and answers the riddle with the title", () => {
    const questions = validateQuestions(
      {
        title_riddle: {
          question: "A war photographer wakes up dead with a week to solve his own murder.",
          answer: "whatever the model echoed",
        },
        detail_questions: [
          { question: "In which city?", answer: "Colombo" },
          { question: "Who holds the photographs?", answer: "Jaki" },
        ],
      },
      CONTEXT,
    );

    expect(questions).toHaveLength(3);
    expect(questions[0]!.type).toBe("title_riddle");
    // The riddle's answer is the title, not whatever the model returned.
    expect(questions[0]!.answer).toBe(CONTEXT.title);
    expect(questions.every((question) => !question.pendingReview)).toBe(true);
  });

  it("flags an answer that does not appear in the source", () => {
    const questions = validateQuestions(
      {
        title_riddle: null,
        detail_questions: [{ question: "Who is the killer?", answer: "Ranchagoda" }],
      },
      CONTEXT,
    );

    // Not in the plot text or the character list: this is the hallucination
    // case, and a flagged question is excluded from every read path.
    expect(questions).toHaveLength(1);
    expect(questions[0]!.pendingReview).toBe(true);
  });

  it("matches answers case- and accent-insensitively", () => {
    const questions = validateQuestions(
      {
        title_riddle: null,
        detail_questions: [{ question: "Where?", answer: "colombo" }],
      },
      CONTEXT,
    );

    expect(questions[0]!.pendingReview).toBe(false);
  });

  it("drops a riddle that leaks the answer rather than storing it", () => {
    const questions = validateQuestions(
      {
        title_riddle: { question: "A book by Shehan Karunatilaka.", answer: "x" },
        detail_questions: [],
      },
      CONTEXT,
    );

    expect(questions).toHaveLength(0);
  });

  it("returns nothing when the model returns nothing", () => {
    expect(validateQuestions({ title_riddle: null, detail_questions: [] }, CONTEXT)).toEqual([]);
  });

  it("caps detail questions at two", () => {
    const questions = validateQuestions(
      {
        title_riddle: null,
        detail_questions: [
          { question: "a", answer: "Colombo" },
          { question: "b", answer: "Jaki" },
          { question: "c", answer: "DD" },
        ],
      },
      CONTEXT,
    );

    expect(questions).toHaveLength(2);
  });
});
