import { describe, expect, it } from "vitest";

import { GeminiError, quotaCooldown, quotaErrorFromBody } from "@/lib/questions/gemini";

/**
 * A 429 stops generation for the whole app, not just for the book that tripped
 * it, so the length of that pause is worth getting right in both directions:
 * too long is a self-inflicted outage over a per-minute blip, too short is a
 * stream of doomed calls against an exhausted daily allowance.
 *
 * Google says which it is. These cover reading that answer, and behaving
 * sanely when it is missing or nonsense.
 */

/** The shape Google actually returns, trimmed of the prose message. */
function body(details: unknown[]): string {
  return JSON.stringify({
    error: { code: 429, message: "Resource has been exhausted", status: "RESOURCE_EXHAUSTED", details },
  });
}

const retryInfo = (delay: string) => ({
  "@type": "type.googleapis.com/google.rpc.RetryInfo",
  retryDelay: delay,
});

const quotaFailure = (quotaId: string) => ({
  "@type": "type.googleapis.com/google.rpc.QuotaFailure",
  violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_requests", quotaId }],
});

describe("quotaErrorFromBody", () => {
  it("reads the retry delay and the per-minute scope", () => {
    const error = quotaErrorFromBody(
      body([
        quotaFailure("GenerateRequestsPerMinutePerProjectPerModel-FreeTier"),
        retryInfo("41s"),
      ]),
    );

    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(41);
    expect(error.quotaScope).toBe("minute");
  });

  it("recognises the per-day scope", () => {
    const error = quotaErrorFromBody(
      body([quotaFailure("GenerateRequestsPerDayPerProjectPerModel-FreeTier")]),
    );

    expect(error.quotaScope).toBe("day");
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it("prefers the day scope when a request trips both", () => {
    const error = quotaErrorFromBody(
      body([
        quotaFailure("GenerateRequestsPerMinutePerProjectPerModel-FreeTier"),
        quotaFailure("GenerateRequestsPerDayPerProjectPerModel-FreeTier"),
      ]),
    );

    // The minute clears on its own; the day is the one that actually holds.
    expect(error.quotaScope).toBe("day");
  });

  it("rounds a fractional delay up rather than down", () => {
    // Waiting 1s on a "1.5s" hint just earns a second 429.
    expect(quotaErrorFromBody(body([retryInfo("1.5s")])).retryAfterSeconds).toBe(2);
  });

  it("survives a body that is not the expected shape", () => {
    for (const raw of ["", "<html>502</html>", "{}", '{"error":{}}', '{"error":{"details":[]}}']) {
      const error = quotaErrorFromBody(raw);
      expect(error.quotaScope).toBe("unknown");
      expect(error.retryAfterSeconds).toBeUndefined();
    }
  });
});

describe("quotaCooldown", () => {
  it("waits as long as Google asks", () => {
    expect(quotaCooldown(quotaErrorFromBody(body([retryInfo("120s")])))).toBe(120);
  });

  it("never waits less than the floor, however short the hint", () => {
    // A hint of 0s would otherwise busy-loop straight back into the 429.
    expect(quotaCooldown(quotaErrorFromBody(body([retryInfo("0s")])))).toBe(30);
  });

  it("never waits more than an hour, however long the hint", () => {
    expect(quotaCooldown(quotaErrorFromBody(body([retryInfo("86400s")])))).toBe(60 * 60);
  });

  it("backs off hard on an unhinted day quota, gently on an unhinted minute one", () => {
    const day = quotaErrorFromBody(body([quotaFailure("...PerDay...-FreeTier")]));
    const minute = quotaErrorFromBody(body([quotaFailure("...PerMinute...-FreeTier")]));

    expect(quotaCooldown(day)).toBe(60 * 60);
    expect(quotaCooldown(minute)).toBe(60);
  });

  it("falls back to fifteen minutes when the body says nothing", () => {
    expect(quotaCooldown(new GeminiError("429", 429))).toBe(15 * 60);
  });
});
