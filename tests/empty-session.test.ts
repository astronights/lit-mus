import { describe, expect, it } from "vitest";

import { explainEmptySession } from "@/lib/drill-status";

/**
 * The empty state used to say "seed some books first" whatever went wrong,
 * which on a shelf of two thousand books sent you looking in exactly the wrong
 * place. These are the four things that can actually be true.
 */
describe("explainEmptySession", () => {
  it("says to seed when the session genuinely had no candidates", () => {
    expect(explainEmptySession([])).toContain("seed some books");
  });

  it("names the missing API key, which is the deployment's fault and not the shelf's", () => {
    const message = explainEmptySession(["no_questions", "generation_unavailable"]);

    expect(message).toContain("GEMINI_API_KEY");
  });

  it("prefers the key over other reasons, since it explains all of them", () => {
    expect(explainEmptySession(["generation_unavailable", "throttled"])).toContain(
      "GEMINI_API_KEY",
    );
  });

  it("reports throttling as temporary", () => {
    expect(explainEmptySession(["no_questions", "throttled"]).toLowerCase()).toContain("minute");
  });

  it("blames the network only when every book failed that way", () => {
    expect(explainEmptySession(["unreachable", "unreachable"])).toContain("Wikipedia");
    expect(explainEmptySession(["unreachable", "no_questions"])).not.toContain("Couldn't reach");
  });

  it("counts the books tried when the articles were simply too thin", () => {
    expect(explainEmptySession(["no_questions", "no_questions", "no_questions"])).toContain(
      "Tried 3 books",
    );
  });
});
