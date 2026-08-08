import { describe, expect, it } from "vitest";

import { resolveUpstashCredentials } from "@/lib/rate-limit";

/**
 * Every wrong choice among these variables fails *silently*: the limiter drops
 * back to per-instance counters and the app keeps working, so nothing surfaces
 * while the Gemini daily cap and the 429 cooldown quietly stop being global.
 * That is why the selection is pinned here rather than left to a doc note.
 */

/** Exactly what Vercel's Upstash integration wrote for this project. */
const VERCEL_INTEGRATION = {
  UPSTASH_REDIS_REST_KV_REST_API_READ_ONLY_TOKEN: "read-only-token",
  UPSTASH_REDIS_REST_KV_REST_API_TOKEN: "read-write-token",
  UPSTASH_REDIS_REST_KV_REST_API_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_KV_URL: "rediss://default:pw@example.upstash.io:6379",
  UPSTASH_REDIS_REST_REDIS_URL: "rediss://default:pw@example.upstash.io:6379",
};

describe("resolveUpstashCredentials", () => {
  it("picks the right two out of the integration's five", () => {
    expect(resolveUpstashCredentials(VERCEL_INTEGRATION)).toEqual({
      url: "https://example.upstash.io",
      token: "read-write-token",
    });
  });

  it("never takes the read-only token", () => {
    // It would pass every startup check and fail every INCR.
    const readOnlyOnly = {
      UPSTASH_REDIS_REST_KV_REST_API_READ_ONLY_TOKEN: "read-only-token",
      UPSTASH_REDIS_REST_KV_REST_API_URL: "https://example.upstash.io",
    };

    expect(resolveUpstashCredentials(readOnlyOnly).token).toBeUndefined();
  });

  it("never takes a rediss:// URL for the REST client", () => {
    const tcpOnly = {
      UPSTASH_REDIS_REST_KV_URL: "rediss://default:pw@example.upstash.io:6379",
      UPSTASH_REDIS_REST_REDIS_URL: "rediss://default:pw@example.upstash.io:6379",
      UPSTASH_REDIS_REST_KV_REST_API_TOKEN: "read-write-token",
    };

    expect(resolveUpstashCredentials(tcpOnly).url).toBeUndefined();
  });

  it("reads the documented names", () => {
    expect(
      resolveUpstashCredentials({
        UPSTASH_REDIS_REST_URL: "https://documented.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "documented-token",
      }),
    ).toEqual({ url: "https://documented.upstash.io", token: "documented-token" });
  });

  it("reads the unprefixed names Vercel writes by default", () => {
    expect(
      resolveUpstashCredentials({
        KV_REST_API_URL: "https://bare.upstash.io",
        KV_REST_API_TOKEN: "bare-token",
      }),
    ).toEqual({ url: "https://bare.upstash.io", token: "bare-token" });
  });

  it("prefers an explicit override to a prefixed integration variable", () => {
    const both = { ...VERCEL_INTEGRATION, UPSTASH_REDIS_REST_URL: "https://override.upstash.io" };
    expect(resolveUpstashCredentials(both).url).toBe("https://override.upstash.io");
  });

  it("ignores empty values rather than treating them as configured", () => {
    // Blanking a variable in a dashboard leaves "", which would otherwise
    // satisfy a plain presence check and hand the client an empty URL.
    expect(
      resolveUpstashCredentials({ UPSTASH_REDIS_REST_URL: "  ", KV_REST_API_URL: "" }).url,
    ).toBeUndefined();
  });

  it("finds nothing when nothing is set", () => {
    expect(resolveUpstashCredentials({ DATABASE_URL: "postgres://…" })).toEqual({
      url: undefined,
      token: undefined,
    });
  });
});
