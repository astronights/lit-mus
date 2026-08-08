import { describe, expect, it } from "vitest";

import {
  QuestionParseError,
  parseGenerationResponse,
  riddleLeak,
  titleRestatements,
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

  it("allows a character name, which is a clue rather than the answer", () => {
    // Naming a character does not name the book. Whether *this* character is
    // famous enough to help is the prompt's call, not something checkable here.
    expect(riddleLeak("A photographer who must reach Jaki from beyond.", CONTEXT)).toBeNull();
  });

  it("still catches a character the book is named after", () => {
    // The reason the blanket ban could go: for a book named after its
    // protagonist, naming the character is naming the title, and the title
    // checks above already cover it however the riddle phrases it.
    const emma = { title: "Emma", author: "Jane Austen", characterNames: ["Emma Woodhouse"] };
    expect(riddleLeak("A wealthy young matchmaker, Emma Woodhouse, meddles.", emma)).toBe("title");

    const karenina = {
      title: "Anna Karenina",
      author: "Leo Tolstoy",
      characterNames: ["Anna Karenina", "Konstantin Levin"],
    };
    expect(
      riddleLeak("A married woman ruined by her affair with Count Vronsky — Karenina.", karenina),
    ).toContain("title word");
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
    expect(questions[0]!.answer).toBe("Booker Prize");
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

  it("drops a detail whose answer the riddle already gave away", () => {
    const questions = validateQuestions(
      {
        title_riddle: {
          question:
            "A dead war photographer is given a handful of nights to solve his own murder, " +
            "in a Colombo of ghosts. Which novel?",
          answer: "x",
        },
        detail_questions: [
          { question: "In which capital city is it set?", answer: "Colombo" },
          { question: "Which conflict is the backdrop?", answer: "Sri Lankan Civil War" },
        ],
      },
      CONTEXT,
    );

    // The riddle names Colombo, so asking for it a moment later tests nothing.
    expect(questions.map((question) => question.answer)).toEqual([
      CONTEXT.title,
      "Sri Lankan Civil War",
    ]);
  });

  it("does not treat a partial word in the riddle as giving the answer away", () => {
    const questions = validateQuestions(
      {
        title_riddle: { question: "A ghost story set in Londonderry. Which novel?", answer: "x" },
        detail_questions: [{ question: "Which city?", answer: "London" }],
      },
      CONTEXT,
    );

    expect(questions).toHaveLength(2);
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

/**
 * A detail answer that restates the title turns the card into riddle-then-
 * riddle. Exact equality caught only the laziest form of it.
 */
describe("titleRestatements", () => {
  it("catches the title with its article dropped", () => {
    const variants = titleRestatements("The Road to Lichfield");
    expect(variants.has("the road to lichfield")).toBe(true);
    expect(variants.has("road to lichfield")).toBe(true);
  });

  it("catches the title with a subtitle trimmed off", () => {
    expect(titleRestatements("Saville: A Novel").has("saville")).toBe(true);
  });

  it("does not collect anything else from the title", () => {
    // Deliberately not substring matching: "Lichfield" on its own is a fine
    // detail answer, and generation is one-shot so a wrong discard is final.
    expect(titleRestatements("The Road to Lichfield").has("lichfield")).toBe(false);
  });
});

describe("validateDetail via validateQuestions", () => {
  const context = { title: "The Road to Lichfield", author: "Penelope Lively", characterNames: [] };

  function detailAnswers(answer: string): string[] {
    return validateQuestions(
      {
        title_riddle: null,
        detail_questions: [{ question: "Which work is this?", answer }],
      },
      context,
    )
      .filter((question) => question.type === "detail")
      .map((question) => question.answer);
  }

  it("drops an answer that is the title without its article", () => {
    expect(detailAnswers("Road to Lichfield")).toEqual([]);
  });

  it("drops an answer that is the exact title", () => {
    expect(detailAnswers("The Road to Lichfield")).toEqual([]);
  });

  it("keeps a real place that merely appears in the title", () => {
    expect(detailAnswers("Lichfield")).toEqual(["Lichfield"]);
  });

  it("keeps an answer sharing a surname with the author", () => {
    // The reason the author check stays exact: this is a legitimate question
    // for Frankenstein, whose author is Mary Shelley.
    expect(
      validateQuestions(
        {
          title_riddle: null,
          detail_questions: [{ question: "Which poet was at Villa Diodati?", answer: "Percy Bysshe Shelley" }],
        },
        { title: "Frankenstein", author: "Mary Shelley", characterNames: [] },
      ).map((question) => question.answer),
    ).toEqual(["Percy Bysshe Shelley"]);
  });
});
