import { fetchJson } from "@/lib/http";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiError extends Error {
  /** HTTP status, when the failure came from a response rather than a timeout. */
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

type GenerateContentResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
};

/**
 * Flash-Lite by default, because the free tier's *daily* cap is what actually
 * bites here: one book is one call, and a session is a dozen of them, so 2.5
 * Flash's allowance is a couple of sessions a day. Flash-Lite's is several
 * times that, which is the difference between drilling when you feel like it
 * and rationing.
 *
 * The cost is recall: the riddles lean on the model knowing a book beyond the
 * plot blurb we hand it, and that is exactly where a lite model is thinner. If
 * the questions read as generic, set GEMINI_MODEL="gemini-2.5-flash" and take
 * the smaller allowance -- the per-minute and per-day budgets follow the model
 * automatically (see FREE_TIER in generate.ts).
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
      // off". GEMINI_MODEL overrides it.
      throw new GeminiError(
        `Gemini returned ${response.status} for model "${geminiModel()}": ${body.slice(0, 300)}`,
        response.status,
      );
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
