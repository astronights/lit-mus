import { Redis } from "@upstash/redis";

/**
 * Fixed-window rate limiter.
 *
 * Backed by Upstash Redis when `UPSTASH_REDIS_REST_URL` / `..._TOKEN` are set,
 * which is the only version that actually works in production -- Vercel runs
 * many function instances and an in-process counter is per instance. Without
 * those env vars we fall back to a per-instance Map, which is fine for local
 * development and better than nothing, but should not be relied on once the
 * URL is public.
 */

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window rolls over. */
  resetSeconds: number;
};

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

export const isDistributedLimiterConfigured = redis !== null;

type MemoryEntry = { count: number; expiresAt: number };
const memory = new Map<string, MemoryEntry>();

function memoryLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const existing = memory.get(key);

  if (!existing || existing.expiresAt <= now) {
    memory.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
    return { ok: true, limit, remaining: limit - 1, resetSeconds: windowSeconds };
  }

  existing.count += 1;
  const resetSeconds = Math.max(1, Math.ceil((existing.expiresAt - now) / 1000));
  return {
    ok: existing.count <= limit,
    limit,
    remaining: Math.max(0, limit - existing.count),
    resetSeconds,
  };
}

/** Opportunistic cleanup so the fallback Map cannot grow without bound. */
function sweepMemory() {
  if (memory.size < 5_000) return;
  const now = Date.now();
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(key);
  }
}

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  if (!redis) {
    sweepMemory();
    return memoryLimit(key, limit, windowSeconds);
  }

  const windowStart = Math.floor(Date.now() / (windowSeconds * 1000));
  const redisKey = `rl:${key}:${windowStart}`;

  try {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, windowSeconds);
    }
    return {
      ok: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetSeconds: windowSeconds,
    };
  } catch (error) {
    // A limiter outage must not take the app down with it; fall back locally.
    console.error("[rate-limit] Upstash unavailable, falling back to memory", error);
    sweepMemory();
    return memoryLimit(key, limit, windowSeconds);
  }
}

/** Best-effort client IP from the proxy headers Vercel sets. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}

export function rateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests. Try again shortly." }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(result.resetSeconds),
        "x-ratelimit-limit": String(result.limit),
        "x-ratelimit-remaining": String(result.remaining),
      },
    },
  );
}
