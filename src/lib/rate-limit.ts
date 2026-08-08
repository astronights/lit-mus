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

/**
 * Which env vars hold the Upstash REST credentials.
 *
 * Takes the environment as an argument so it can be tested against the real
 * variable names a deployment produces, rather than only the ones we document.
 *
 * Three spellings are accepted, in order: the name this app documents, the bare
 * name Vercel writes with no prefix, then any prefixed variant. Vercel's Upstash
 * integration writes under a prefix chosen when the store is connected, so the
 * names arrive as e.g. `UPSTASH_REDIS_REST_KV_REST_API_URL`. Those are
 * integration-managed and not editable by hand, so matching the suffix is what
 * lets them be used as they are instead of copied into duplicates.
 *
 * The suffixes are exact about which of the integration's five variables to
 * take, because the other three all fail *silently* -- the limiter falls back to
 * per-instance counters and the app carries on working:
 *
 *   ...KV_REST_API_URL              yes
 *   ...KV_REST_API_TOKEN            yes
 *   ...KV_REST_API_READ_ONLY_TOKEN  no -- fails every INCR. Excluded because it
 *                                        ends in READ_ONLY_TOKEN, not in
 *                                        KV_REST_API_TOKEN.
 *   ...KV_URL, ...REDIS_URL         no -- rediss:// TCP endpoints, which this
 *                                        HTTPS REST client cannot speak to.
 *                                        Excluded by the same suffix logic.
 */
export function resolveUpstashCredentials(env: Record<string, string | undefined>): {
  url?: string;
  token?: string;
} {
  const exact = (...names: string[]): string | undefined => {
    for (const name of names) {
      const value = env[name]?.trim();
      if (value) return value;
    }
    return undefined;
  };

  // Sorted, so the choice stays deterministic if two stores are connected.
  const bySuffix = (suffix: string): string | undefined => {
    const key = Object.keys(env)
      .filter((name) => name.endsWith(suffix) && env[name]?.trim())
      .sort()[0];
    return key ? env[key]!.trim() : undefined;
  };

  return {
    url: exact("UPSTASH_REDIS_REST_URL", "KV_REST_API_URL") ?? bySuffix("KV_REST_API_URL"),
    token: exact("UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN") ?? bySuffix("KV_REST_API_TOKEN"),
  };
}

const { url: redisUrl, token: redisToken } = resolveUpstashCredentials(process.env);

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
