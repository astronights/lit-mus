import { describe, expect, it } from "vitest";

import {
  QuestionParseError,
  parseGenerationResponse,
  riddleLeak,
  validateQuestions,
} from "@/lib/questions/validate";

const CONTEXT = {
  title: "The Seven Moons of Maali Almeida",
  author: "Shehan Karunatilaka",
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
  it("accepts a quizmaster-style clue that circles the title", () => {
    expect(
      riddleLeak(
        "This Booker winner takes its title from the span of time allotted to its dead " +
          "protagonist, a war photographer, to solve the mystery of his own murder. Which novel?",
        CONTEXT,
      ),
    ).toBeNull();
  });

  it("accepts a clue built on the book's real-world legacy", () => {
    expect(
      riddleLeak(
        "Its sympathetic portrayal of the plight of working animals is said to have been " +
          "instrumental in abolishing the checkrein. Which 1877 work?",
        { title: "Black Beauty", author: "Anna Sewell", characterNames: ["Ginger"] },
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

  it("does not trip on short common words shared with the title", () => {
    expect(
      riddleLeak("Which novel follows a family over seven generations?", {
        title: "The Sea",
        author: "John Banville",
        characterNames: [],
      }),
    ).toBeNull();
  });
});

describe("validateQuestions", () => {
  it("keeps detail answers as written and answers the riddle with the title", () => {
    const questions = validateQuestions(
      {
        title_riddle: {
          question: "A war photographer wakes up dead with a week to solve his own murder.",
          answer: "whatever the model echoed",
        },
        detail_questions: [
          { question: "In which capital city is it set?", answer: "Colombo" },
          { question: "Which conflict is the backdrop?", answer: "Sri Lankan Civil War" },
        ],
      },
      CONTEXT,
    );

    expect(questions).toHaveLength(3);
    expect(questions[0]!.type).toBe("title_riddle");
    // The riddle's answer is the title, not whatever the model returned.
    expect(questions[0]!.answer).toBe(CONTEXT.title);
    expect(questions[1]!.answer).toBe("Colombo");
    // Nothing is flagged any more: detail answers are taken on trust.
    expect(questions.every((question) => !question.pendingReview)).toBe(true);
  });

  it("keeps an answer that appears nowhere in the article text", () => {
    // The model is expected to bring outside knowledge now, so an answer the
    // extract never mentions is the intended case rather than a failure.
    const questions = validateQuestions(
      {
        title_riddle: null,
        detail_questions: [
          { question: "Which prize did it win in 2022?", answer: "Booker Prize" },
        ],
      },
      CONTEXT,
    );

    expect(questions).toHaveLength(1);
    expect(questions[0]!.pendingReview).toBe(false);
  });

  it("drops a detail question whose answer is just the title or the author", () => {
    const questions = validateQuestions(
      {
        title_riddle: null,
        detail_questions: [
          { question: "What is this book called?", answer: "The Seven Moons of Maali Almeida" },
          { question: "Who wrote it?", answer: "Shehan Karunatilaka" },
        ],
      },
      CONTEXT,
    );

    expect(questions).toHaveLength(0);
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
          { question: "b", answer: "Biafra" },
          { question: "c", answer: "London" },
        ],
      },
      CONTEXT,
    );

    expect(questions).toHaveLength(2);
  });
});
