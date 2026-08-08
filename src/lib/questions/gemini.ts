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
 * The default is chosen for being a stable id, not for being the best model.
 *
 * Set GEMINI_MODEL to a current Gemini 3 Flash or Flash-Lite and this app gets
 * better: recall is the thing the riddles live on -- they lean on the model
 * knowing a book past the blurb we hand it -- and the newer free allowances are
 * larger, which matters because one book is one call and a session is a dozen.
 *
 * The reason that is not hard-coded here is that model ids move: the 3.x family
 * switched to a dotted scheme, preview ids get retired, dated suffixes come and
 * go. A wrong id 404s on every single call rather than degrading, so the
 * default stays on something long-lived and `npm run check:models` prints the
 * ids the configured key can actually use.
 */
export function geminiModel(): string {
  return process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite";
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
 */
export async function generateJson(prompt: string, timeoutMs = 20_000): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${ENDPOINT}/${geminiModel()}:generateContent`, {
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
          maxOutputTokens: 1_024,
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
        `Gemini returned ${response.status} for model "${geminiModel()}": ${body.slice(0, 300)}`,
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

    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
    if (!text) throw new GeminiError("Gemini returned no text");
    return text;
  } finally {
    clearTimeout(timer);
  }
}
