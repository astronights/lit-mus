import { describe, expect, it } from "vitest";

import { scoreModel } from "@/lib/questions/gemini";

/**
 * The model is picked by ranking whatever the key reports, rather than by a
 * hard-coded id, because ids move faster than this repo does and a wrong one
 * 404s on every call. These pin the ordering that ranking is supposed to encode.
 */

/** Best-first, the way `resolveModel` sorts. */
function rank(ids: string[]): string[] {
  return ids
    .map((id) => ({ id, score: scoreModel(id) }))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => b.score - a.score || a.id.length - b.id.length)
    .map((candidate) => candidate.id);
}

describe("scoreModel", () => {
  it("prefers a newer family over an older one", () => {
    expect(rank(["gemini-2.5-flash", "gemini-3-flash"])[0]).toBe("gemini-3-flash");
    expect(rank(["gemini-3-flash", "gemini-3.1-flash"])[0]).toBe("gemini-3.1-flash");
  });

  it("prefers Flash over Flash-Lite within a family", () => {
    // Recall is what the riddles live on, and Flash's allowance is still ample.
    expect(rank(["gemini-3-flash-lite", "gemini-3-flash"])[0]).toBe("gemini-3-flash");
  });

  it("ranks Pro below both, despite being the better model", () => {
    // Deliberate: Pro's free daily allowance cannot support a dozen-call
    // session, and running out mid-session is worse than a slightly weaker
    // question.
    expect(rank(["gemini-3-pro", "gemini-3-flash", "gemini-3-flash-lite"])).toEqual([
      "gemini-3-flash",
      "gemini-3-flash-lite",
      "gemini-3-pro",
    ]);
  });

  it("prefers a stable id over a preview or experimental one", () => {
    expect(rank(["gemini-3-flash-preview", "gemini-3-flash"])[0]).toBe("gemini-3-flash");
    expect(rank(["gemini-3-flash-exp", "gemini-3-flash"])[0]).toBe("gemini-3-flash");
  });

  it("prefers a bare alias over a pinned dated build", () => {
    // The dated build is retired on a schedule; the alias survives it.
    expect(rank(["gemini-3-flash-09-2026", "gemini-3-flash"])[0]).toBe("gemini-3-flash");
  });

  it("rejects anything that is not a text generator", () => {
    for (const id of [
      "text-embedding-004",
      "gemini-embedding-001",
      "gemini-2.5-flash-image",
      "gemini-2.5-flash-preview-tts",
      "gemini-live-2.5-flash-preview",
      "imagen-4.0-generate-001",
      "veo-3.0-generate-001",
      "gemini-2.5-computer-use-preview",
      "aqa",
    ]) {
      expect(scoreModel(id), id).toBeLessThan(0);
    }
  });

  it("rejects a gemini id with no recognisable tier", () => {
    expect(scoreModel("gemini-3-something-new")).toBeLessThan(0);
  });

  it("picks the intended model out of a realistic listing", () => {
    const listing = [
      "gemini-2.0-flash",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.5-pro",
      "gemini-3-flash",
      "gemini-3-flash-lite",
      "gemini-3-flash-preview-11-2025",
      "gemini-3-pro",
      "gemini-embedding-001",
      "imagen-4.0-generate-001",
      "text-embedding-004",
    ];

    expect(rank(listing)[0]).toBe("gemini-3-flash");
  });
});
