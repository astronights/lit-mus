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

/** First of these env vars with a non-empty value. */
function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/*
 * Two spellings accepted. `UPSTASH_REDIS_REST_*` is what this app documents;
 * `KV_REST_API_*` is what Vercel's Upstash integration writes by itself, and
 * making people copy one into the other is a step at which the wrong value gets
 * picked. There are five variables in that integration's output and only two are
 * usable -- the read-only token silently fails every INCR, and the KV_URL /
 * REDIS_URL pair are rediss:// TCP endpoints that this HTTPS REST client cannot
 * speak to at all.
 */
const redisUrl = firstEnv("UPSTASH_REDIS_REST_URL", "KV_REST_API_URL");
const redisToken = firstEnv("UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN");

/**
 * A `rediss://` URL here is the commonest way to configure this wrongly, and it
 * would otherwise fail per request rather than at startup -- which, since the
 * limiter falls back silently, means never being noticed at all.
 */
function usableRestUrl(url: string | undefined): url is string {
  if (!url) return false;
  if (/^https?:\/\//.test(url)) return true;

  console.warn(
    `[rate-limit] ignoring Upstash URL "${url.slice(0, 12)}…": the REST client needs the ` +
      `https:// endpoint (KV_REST_API_URL), not a rediss:// connection string. ` +
      `Falling back to per-instance counters.`,
  );
  return false;
}

const redis =
  usableRestUrl(redisUrl) && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

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

/**
 * Mark a cooldown: "stop doing this until the TTL expires".
 *
 * Distinct from `rateLimit`, which counts. This is for the case where an
 * upstream has told us to stop -- a 429 from Gemini means the quota is gone,
 * and continuing to ask burns attempts and makes every user wait for a call
 * that cannot succeed.
 */
export async function markCooldown(key: string, seconds: number): Promise<void> {
  if (!redis) {
    memory.set(`cooldown:${key}`, { count: 1, expiresAt: Date.now() + seconds * 1000 });
    return;
  }
  try {
    await redis.set(`cooldown:${key}`, "1", { ex: seconds });
  } catch (error) {
    console.error("[rate-limit] could not set cooldown", error);
  }
}

/** Seconds left on a cooldown, or 0 if it is clear. */
export async function cooldownRemaining(key: string): Promise<number> {
  if (!redis) {
    const entry = memory.get(`cooldown:${key}`);
    if (!entry) return 0;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }
  try {
    const ttl = await redis.ttl(`cooldown:${key}`);
    return ttl > 0 ? ttl : 0;
  } catch {
    return 0;
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
