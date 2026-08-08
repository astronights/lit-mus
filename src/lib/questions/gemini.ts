import { fetchJson } from "@/lib/http";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Which ceiling a 429 hit, when Google's response says. */
export type QuotaScope = "minute" | "day" | "unknown";

export class GeminiError extends Error {
  /** HTTP status, when the failure came from a response rather than a timeout. */
  status?: number;
  /** `RetryInfo.retryDelay` from the error body, in seconds, when present. */
  retryAfterSeconds?: number;
  /** Parsed from `QuotaFailure.violations[].quotaId`. */
  quotaScope?: QuotaScope;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

type ErrorDetail = {
  "@type"?: string;
  retryDelay?: string;
  violations?: Array<{ quotaId?: string; quotaMetric?: string; quotaValue?: string }>;
};

/**
 * Pull the quota facts out of a 429 body.
 *
 * Google tells us both how long to wait (`RetryInfo.retryDelay`) and which
 * ceiling we hit (`QuotaFailure.violations[].quotaId`, e.g.
 * "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"). Both matter: a
 * per-minute 429 clears in under a minute, while a per-day one does not clear
 * today, and treating them the same means either a pointless fifteen-minute
 * outage or a stream of doomed retries.
 *
 * Best-effort by design. The shape is Google's standard `google.rpc` detail
 * encoding, but it is not contractual for our purposes, so anything unreadable
 * leaves the fields undefined and the caller falls back to its own default.
 */
function readQuotaFailure(body: string): { retryAfterSeconds?: number; quotaScope: QuotaScope } {
  let details: ErrorDetail[] = [];

  try {
    const parsed = JSON.parse(body) as { error?: { details?: ErrorDetail[] } };
    details = parsed.error?.details ?? [];
  } catch {
    return { quotaScope: "unknown" };
  }

  let retryAfterSeconds: number | undefined;
  let quotaScope: QuotaScope = "unknown";

  for (const detail of details) {
    // "29s", occasionally fractional ("1.5s").
    const delay = detail.retryDelay?.match(/^([\d.]+)s$/);
    if (delay) retryAfterSeconds = Math.ceil(Number(delay[1]));

    for (const violation of detail.violations ?? []) {
      const id = violation.quotaId ?? violation.quotaMetric ?? "";
      // Per-day wins: when a request trips both, the day is the one that lasts.
      if (/perday/i.test(id)) quotaScope = "day";
      else if (/perminute/i.test(id) && quotaScope !== "day") quotaScope = "minute";
    }
  }

  return { retryAfterSeconds, quotaScope };
}

/** Floor and ceiling on a cooldown, however long Google says to wait. */
const MIN_COOLDOWN_SECONDS = 30;
const MAX_COOLDOWN_SECONDS = 60 * 60;
/** Used when a 429 arrives with no readable quota detail at all. */
const FALLBACK_COOLDOWN_SECONDS = 15 * 60;

/**
 * How long to stop asking after a 429, taken from Google's own answer.
 *
 * A flat fifteen minutes was too blunt in both directions. Tripping the
 * per-minute limit clears in under a minute, so fifteen minutes of refusing to
 * generate was self-inflicted; running out of the daily allowance does not
 * clear in fifteen minutes, so we went back and burned another call to be told
 * so again. The error body distinguishes the two.
 *
 * Lives here rather than in generate.ts so it can be tested without a database.
 */
export function quotaCooldown(error: GeminiError): number {
  const hinted = error.retryAfterSeconds;

  if (hinted !== undefined) {
    // Clamped: a hint of 0 would busy-loop, and an implausibly long one would
    // take generation out for the rest of the session over a transient blip.
    return Math.min(Math.max(hinted, MIN_COOLDOWN_SECONDS), MAX_COOLDOWN_SECONDS);
  }

  // No hint. A day quota won't recover soon, so back off as far as we allow.
  if (error.quotaScope === "day") return MAX_COOLDOWN_SECONDS;
  if (error.quotaScope === "minute") return MIN_COOLDOWN_SECONDS * 2;
  return FALLBACK_COOLDOWN_SECONDS;
}

/**
 * Build the error a 429 body describes. Exported for tests -- the live path
 * goes through `generateJson`, which needs a network round trip to reach.
 */
export function quotaErrorFromBody(body: string): GeminiError {
  const error = new GeminiError(`Gemini returned 429: ${body.slice(0, 300)}`, 429);
  const quota = readQuotaFailure(body);
  error.retryAfterSeconds = quota.retryAfterSeconds;
  error.quotaScope = quota.quotaScope;
  return error;
}

type GenerateContentResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
};

/**
 * Used only when the key cannot be asked -- see `resolveModel`. Long-lived id,
 * chosen for still existing rather than for being the best available.
 */
const FALLBACK_MODEL = "gemini-2.5-flash-lite";

/** The configured model, or the fallback. Synchronous; does not resolve. */
export function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || FALLBACK_MODEL;
}

/**
 * How much we want a given model, from its id alone. Higher is better; -1 means
 * "not a candidate".
 *
 * This exists instead of a hard-coded model name because the ids move faster
 * than the repo does — the 3.x family switched to a dotted scheme, preview ids
 * are retired on a schedule, dated suffixes come and go — and a wrong id 404s on
 * *every* call rather than degrading. Ranking a live list is the version of
 * "use the newest good model" that keeps working after the next rename.
 *
 * The ordering encodes what this app actually needs:
 *  - newer family first; recall is what the riddles live on
 *  - Flash over Flash-Lite over Pro. Not a quality ordering — Pro is better and
 *    its free daily allowance is far too small for a dozen-call session
 *  - stable over preview, undated alias over a pinned date
 */
export function scoreModel(id: string): number {
  const family = id.match(/^gemini-(\d+(?:\.\d+)?)-/);
  if (!family) return -1;

  // Anything that is not a plain text generator: embeddings, images, speech,
  // the realtime endpoints. `generateContent` alone does not exclude these.
  if (/embedding|aqa|image|imagen|tts|audio|live|veo|vision|robotics|computer-use/.test(id)) {
    return -1;
  }

  let score = Number(family[1]) * 100;

  if (/-flash-lite\b/.test(id)) score += 10;
  else if (/-flash\b/.test(id)) score += 20;
  else if (/-pro\b/.test(id)) score += 5;
  else return -1;

  if (/preview|-exp\b|experimental/.test(id)) score -= 3;
  // "gemini-3-flash" over "gemini-3-flash-09-2026": the bare alias keeps
  // working when the dated build is retired.
  if (/\d{2}-\d{4}$|\d{4}-\d{2}-\d{2}$/.test(id)) score -= 1;

  return score;
}

let resolved: string | null = null;
let resolving: Promise<string> | null = null;

/**
 * The model to actually call.
 *
 * `GEMINI_MODEL` wins outright when set — an explicit choice is never
 * second-guessed. Otherwise the key is asked what it can use and the best
 * candidate wins, cached for the life of the process.
 *
 * A failure to list is not fatal and is deliberately *not* cached: it returns
 * the fallback and tries again next time, so a blip during one cold start does
 * not pin an instance to an old model for as long as it lives.
 */
export async function resolveModel(): Promise<string> {
  const configured = process.env.GEMINI_MODEL?.trim();
  if (configured) return configured;
  if (resolved) return resolved;
  // Share one lookup: with generation serialised this is rare, but two callers
  // racing on a cold start should not both spend a round trip.
  if (resolving) return resolving;

  resolving = pickBestAvailable()
    .then((id) => {
      resolved = id;
      console.log(`[questions] using Gemini model "${id}" (auto-selected)`);
      return id;
    })
    .catch((error) => {
      console.warn(
        `[questions] could not list models (${error instanceof Error ? error.message : error}); ` +
          `falling back to "${FALLBACK_MODEL}"`,
      );
      return FALLBACK_MODEL;
    })
    .finally(() => {
      resolving = null;
    });

  return resolving;
}

async function pickBestAvailable(): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not set");

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
    { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new GeminiError(`ListModels returned ${response.status}`, response.status);

  const data = (await response.json()) as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };

  const best = (data.models ?? [])
    .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
    .map((model) => (model.name ?? "").replace(/^models\//, ""))
    .map((id) => ({ id, score: scoreModel(id) }))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => b.score - a.score || a.id.length - b.id.length)[0];

  if (!best) throw new GeminiError("no usable model in ListModels response");
  return best.id;
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Serialises Gemini work inside this process: one turn runs at a time, the
 * next starts only when the previous has settled.
 *
 * The drill client already fetches cards one at a time, but that only holds
 * for one tab. Two tabs, or a book page generating in the background while a
 * drill session runs, would still overlap -- and two free-tier calls landing
 * together is exactly what trips a 429, which costs a fifteen-minute cooldown
 * for the whole app rather than for the one book.
 *
 * A promise chain, not a real lock. It serialises within a single Node process
 * only; on Vercel every function instance has its own chain. This narrows the
 * window rather than closing it -- the Upstash-backed limiter in generate.ts is
 * what makes the ceiling actually global.
 */
let turns: Promise<unknown> = Promise.resolve();

export function withGeminiTurn<T>(run: () => Promise<T>): Promise<T> {
  // `run` on both branches: a turn that threw must not stall the queue behind
  // it, and it must not reject the chain either.
  const turn = turns.then(run, run);
  turns = turn.then(
    () => undefined,
    () => undefined,
  );
  return turn;
}

/**
 * One `generateContent` call against Gemini Flash.
 *
 * `responseMimeType: application/json` gets us structured output without a
 * schema round trip; the parser still strips fences defensively.
 * Temperature is low-ish: riddles need some flair, but a creative model
 * inventing plot details is the exact failure we validate against.
 *
 * The token budget and the timeout are both sized for a *thinking* model, which
 * is what the 2.5 and 3.x families are. Reasoning tokens are spent from the
 * same `maxOutputTokens` budget as the answer, so the old 1,024 was mostly
 * consumed before the JSON began and the response arrived truncated
 * mid-string -- surfacing as "not valid JSON" at around column 130, which
 * blamed the model for output we had cut off ourselves. For the same reason
 * these calls are simply slower than a non-thinking model, and 20s was not
 * enough to finish one.
 */
export async function generateJson(prompt: string, timeoutMs = 60_000): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not set");

  const model = await resolveModel();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.6,
          // Three short questions need a few hundred tokens; the rest of this
          // is headroom for reasoning, which is charged to the same budget.
          maxOutputTokens: 8_192,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // The model name is in the message because it is the likeliest thing to
      // be wrong: an unavailable or renamed model 404s on every single call,
      // which looks like "generation is broken" rather than "one setting is
      // off". `npm run check:models` lists the ids this key can use.
      const error = new GeminiError(
        `Gemini returned ${response.status} for model "${model}": ${body.slice(0, 300)}`,
        response.status,
      );

      if (response.status === 429) {
        const quota = readQuotaFailure(body);
        error.retryAfterSeconds = quota.retryAfterSeconds;
        error.quotaScope = quota.quotaScope;
      }

      throw error;
    }

    const data = (await response.json()) as GenerateContentResponse;

    if (data.promptFeedback?.blockReason) {
      throw new GeminiError(`Gemini blocked the prompt: ${data.promptFeedback.blockReason}`);
    }

    /*
     * A truncated response is not malformed output, and the difference matters
     * to the caller: retrying identical parameters reproduces it exactly, so
     * the retry-once-on-bad-JSON path was spending a second call to fail at
     * almost the same character. Reported as its own error so it is not
     * retried, and so the message names the budget rather than the model.
     */
    const finishReason = data.candidates?.[0]?.finishReason;
    if (finishReason === "MAX_TOKENS") {
      throw new GeminiError(
        `Gemini hit maxOutputTokens for model "${model}" and returned a truncated response. ` +
          `Thinking models spend this budget on reasoning before the answer begins.`,
      );
    }

    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
    if (!text) throw new GeminiError("Gemini returned no text");
    return text;
  } finally {
    clearTimeout(timer);
  }
}
