/**
 * Shared fetch helpers for the external APIs.
 *
 * Every upstream here is a free, unauthenticated service, so being a polite
 * client matters: identify ourselves, cap how long we wait, and never let one
 * slow source hold the whole hydration open.
 */

export const USER_AGENT =
  "lit-mus/0.1 (personal literature quiz reference app; https://github.com/astronights/lit-mus)";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} from ${url}`);
    this.name = "HttpError";
  }
}

export async function fetchJson<T>(
  url: string,
  { timeoutMs = 6_000, headers = {} }: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "application/json", ...headers },
      // Hydration is a cache miss by definition; there is nothing to reuse.
      cache: "no-store",
    });
    if (!response.ok) throw new HttpError(response.status, url);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a source fetch so that its failure degrades the result instead of
 * failing the request. A book with a cover but no plot is still worth showing.
 */
export async function optional<T>(label: string, task: () => Promise<T>): Promise<T | null> {
  try {
    return await task();
  } catch (error) {
    console.warn(`[hydrate] ${label} failed`, error instanceof Error ? error.message : error);
    return null;
  }
}
