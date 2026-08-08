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

  it("separates a generation crash from a thin article, and shows the cause", () => {
    // Twelve books failing in a row is never twelve thin articles; it is one
    // fault reported twelve times, and the message has to say which.
    const message = explainEmptySession(
      ["generation_failed", "generation_failed"],
      "Prompt file not found",
    );

    expect(message).toContain("Prompt file not found");
    expect(message).toContain("app's side");
    expect(message).not.toContain("Wikipedia article");
  });

  it("names the quota and when it comes back, without blaming the books", () => {
    const message = explainEmptySession(
      ["quota_exceeded"],
      "Retry in about 15 minutes.",
    );

    expect(message).toContain("quota");
    expect(message).toContain("midnight US Pacific");
    expect(message).toContain("15 minutes");
    expect(message).not.toContain("Wikipedia article");
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

/**
 * A 503 from Gemini ("this model is currently experiencing high demand") used
 * to arrive as `generation_failed`, which the client treats as fatal -- so a
 * passing spike at Google aborted the whole session and told the player it was
 * the app's fault. It is now its own reason, non-fatal, with wording that says
 * what it is.
 */
describe("a busy model", () => {
  it("does not read as the app being broken", () => {
    const message = explainEmptySession(["model_busy", "model_busy"]);

    expect(message).toMatch(/busy/i);
    expect(message).not.toMatch(/fault|failed|broken/i);
  });

  it("still reports a real failure when one is mixed in", () => {
    // A genuine fault must not be masked by whichever reason came first.
    const message = explainEmptySession(["model_busy", "generation_failed"], "boom");
    expect(message).toMatch(/fault on the app's side/);
  });
});
