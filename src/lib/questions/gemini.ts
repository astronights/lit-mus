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

export function geminiModel(): string {
  return process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
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
