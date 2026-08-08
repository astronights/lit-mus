import { describe, expect, it } from "vitest";

import { withGeminiTurn } from "@/lib/questions/gemini";

/**
 * The whole point of `withGeminiTurn` is that two calls never overlap: the free
 * tier's per-minute cap is small, and a 429 costs a fifteen-minute cooldown for
 * the entire app rather than for the one book that tripped it.
 *
 * So the thing worth asserting is concurrency, not ordering -- a test that only
 * checked the results came back in order would pass on a fully parallel
 * implementation.
 */
describe("withGeminiTurn", () => {
  /** Resolves after a tick, recording how many copies of itself were running. */
  function tracker() {
    let running = 0;
    let peak = 0;

    const run = async <T>(value: T): Promise<T> => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return value;
    };

    return { run, peak: () => peak };
  }

  it("runs one turn at a time", async () => {
    const { run, peak } = tracker();

    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => withGeminiTurn(() => run(n))),
    );

    expect(peak()).toBe(1);
    expect(results).toEqual([1, 2, 3, 4, 5]);
  });

  it("lets the next turn through after one throws", async () => {
    const failed = withGeminiTurn(async () => {
      throw new Error("429");
    });

    // The rejection belongs to the caller, and must not travel down the chain.
    await expect(failed).rejects.toThrow("429");
    await expect(withGeminiTurn(async () => "next")).resolves.toBe("next");
  });

  it("does not start a turn before the one ahead of it has settled", async () => {
    const order: string[] = [];

    const first = withGeminiTurn(async () => {
      order.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("first:end");
    });
    const second = withGeminiTurn(async () => {
      order.push("second:start");
    });

    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });
});
