import { describe, expect, it } from "vitest";

import {
  BOX_INTERVAL_DAYS,
  composeSession,
  scheduleNext,
  type Candidate,
} from "@/lib/leitner";

const NOW = new Date("2026-08-07T09:00:00.000Z");

function days(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

describe("scheduleNext", () => {
  it("promotes one box on a clean pass and schedules by the table", () => {
    const result = scheduleNext({
      box: 2,
      outcomes: ["got_it", "got_it", "got_it"],
      questionCount: 3,
      now: NOW,
    });

    expect(result.box).toBe(3);
    expect(result.cleanPass).toBe(true);
    expect(days(NOW, result.dueAt)).toBe(BOX_INTERVAL_DAYS[3]);
  });

  it("keeps a partial pass in the same box, due next session", () => {
    const result = scheduleNext({
      box: 3,
      outcomes: ["got_it", "missed", "got_it"],
      questionCount: 3,
      now: NOW,
    });

    expect(result.box).toBe(3);
    expect(result.cleanPass).toBe(false);
    expect(result.dueAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(days(NOW, result.dueAt)).toBeLessThanOrEqual(1);
  });

  it("demotes to box 1 when nothing was answered correctly", () => {
    const result = scheduleNext({
      box: 4,
      outcomes: ["missed", "missed", "missed"],
      questionCount: 3,
      now: NOW,
    });

    expect(result.box).toBe(1);
  });

  it("keeps box 5 at box 5 on a clean pass, on the long loop", () => {
    const result = scheduleNext({
      box: 5,
      outcomes: ["got_it", "got_it", "got_it"],
      questionCount: 3,
      now: NOW,
    });

    // Box 5 is "known it", not "gone": it comes back in about six weeks.
    expect(result.box).toBe(5);
    expect(days(NOW, result.dueAt)).toBe(BOX_INTERVAL_DAYS[5]);
  });

  it("treats a fully skipped card as neutral -- no move, nothing recorded", () => {
    const result = scheduleNext({ box: 3, outcomes: [], questionCount: 3, now: NOW });

    expect(result.counted).toBe(false);
    expect(result.box).toBe(3);
    expect(result.cleanPass).toBe(false);
  });

  it("does not count a partially skipped card as a clean pass", () => {
    // Two answered correctly, one skipped: that is not three out of three, and
    // promoting on it would be promoting on incomplete evidence.
    const result = scheduleNext({
      box: 1,
      outcomes: ["got_it", "got_it"],
      questionCount: 3,
      now: NOW,
    });

    expect(result.cleanPass).toBe(false);
    expect(result.box).toBe(1);
  });
});

describe("composeSession", () => {
  const overdue = (id: number, box: number, daysAgo: number): Candidate => ({
    bookId: id,
    box,
    dueAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
  });

  it("puts due books first, oldest first", () => {
    const queue = composeSession(
      [overdue(1, 2, 1), overdue(2, 3, 10), overdue(3, 1, 5)],
      { size: 3, newBooks: 0, now: NOW },
    );

    expect(queue).toEqual([2, 3, 1]);
  });

  it("folds in a few never-drilled books to keep coverage expanding", () => {
    const candidates: Candidate[] = [
      ...Array.from({ length: 10 }, (_, index) => overdue(index + 1, 2, 1)),
      { bookId: 100, box: null, dueAt: null },
      { bookId: 101, box: null, dueAt: null },
    ];

    const queue = composeSession(candidates, { size: 6, newBooks: 2, now: NOW });

    expect(queue).toHaveLength(6);
    expect(queue.filter((id) => id >= 100)).toHaveLength(2);
  });

  it("tops up from not-yet-due books when the due queue is thin", () => {
    const candidates: Candidate[] = [
      overdue(1, 1, 1),
      { bookId: 2, box: 4, dueAt: new Date(NOW.getTime() + 5 * 86_400_000) },
      { bookId: 3, box: 1, dueAt: new Date(NOW.getTime() + 5 * 86_400_000) },
    ];

    const queue = composeSession(candidates, { size: 3, newBooks: 0, now: NOW, random: () => 0 });

    expect(queue[0]).toBe(1);
    // Lower box first among the not-yet-due top-ups.
    expect(queue.slice(1)).toEqual([3, 2]);
  });

  it("fills the session from never-drilled books when nothing is in rotation", () => {
    // Day one: no drill state at all. The new-book quota must not cap the
    // session at three cards and call it done.
    const candidates: Candidate[] = Array.from({ length: 30 }, (_, index) => ({
      bookId: index + 1,
      box: null,
      dueAt: null,
    }));

    expect(composeSession(candidates, { size: 12, newBooks: 3, now: NOW })).toHaveLength(12);
  });

  it("still caps new books when there are due ones competing for the session", () => {
    const candidates: Candidate[] = [
      ...Array.from({ length: 20 }, (_, index) => overdue(index + 1, 2, 3)),
      ...Array.from({ length: 20 }, (_, index) => ({
        bookId: 100 + index,
        box: null,
        dueAt: null,
      })),
    ];

    const queue = composeSession(candidates, { size: 10, newBooks: 3, now: NOW });

    expect(queue).toHaveLength(10);
    expect(queue.filter((id) => id >= 100)).toHaveLength(3);
  });

  it("never repeats a book within a session", () => {
    const candidates: Candidate[] = [overdue(1, 1, 1), overdue(1, 1, 1), overdue(2, 1, 1)];
    const queue = composeSession(candidates, { size: 10, newBooks: 0, now: NOW });

    expect(new Set(queue).size).toBe(queue.length);
  });
});
