import { describe, expect, it } from "vitest";
import {
  blockKeyFor,
  blockMarkSchema,
  dailyReviewSchema,
  goalMarkSchema,
  logSlotSchema,
  weeklyReviewSchema
} from "../src/review";

describe("dailyReviewSchema", () => {
  it("fills in defaults for an otherwise-empty payload", () => {
    const parsed = dailyReviewSchema.parse({
      date: "2026-04-29",
      timezone: "Australia/Melbourne"
    });
    expect(parsed.plannedBlocksSnapshot).toEqual([]);
    expect(parsed.slots).toEqual([]);
    expect(parsed.blockMarks).toEqual([]);
    expect(parsed.goalMarks).toEqual([]);
    expect(parsed.morning.intentions).toEqual([]);
    expect(parsed.morning.gratitude).toEqual([]);
    expect(parsed.evening.wins).toEqual([]);
    expect(parsed.evening.hp6Score).toEqual({});
  });

  it("round-trips a fully populated payload", () => {
    const input = {
      date: "2026-04-29",
      timezone: "Australia/Melbourne",
      plannedBlocksSnapshot: [
        { goalId: "g1", title: "Deep work", startMs: 1, endMs: 2 }
      ],
      morning: {
        intentions: ["Ship review v1"],
        gratitude: ["Sleep", "Coffee"],
        todaysFocus: "review-page",
        hp6Focus: "productivity" as const
      },
      slots: [
        {
          startMinute: 360,
          endMinute: 375,
          goalId: "g1",
          category: "goal" as const,
          energy: "energise" as const,
          note: "kick-off"
        }
      ],
      blockMarks: [
        { blockKey: "g1:1", status: "done" as const, actualMinutes: 90 }
      ],
      goalMarks: [
        { goalId: "g1", status: "in-progress" as const, actualMinutes: 90 }
      ],
      evening: {
        wins: ["finished schema"],
        improvements: ["start earlier"],
        tomorrow: "wire allocator",
        hp6Score: { productivity: 8, energy: 7 }
      }
    };
    const parsed = dailyReviewSchema.parse(input);
    expect(parsed.morning.hp6Focus).toBe("productivity");
    expect(parsed.evening.hp6Score.productivity).toBe(8);
    expect(parsed.slots[0]?.energy).toBe("energise");
  });

  it("rejects malformed dates", () => {
    expect(() =>
      dailyReviewSchema.parse({ date: "29/04/2026", timezone: "UTC" })
    ).toThrow();
  });

  it("rejects zero-length log slots", () => {
    expect(() =>
      logSlotSchema.parse({ startMinute: 360, endMinute: 360 })
    ).toThrow();
  });

  it("defaults log slot category and energy", () => {
    const slot = logSlotSchema.parse({ startMinute: 360, endMinute: 375 });
    expect(slot.category).toBe("goal");
    expect(slot.energy).toBe("neutral");
  });
});

describe("blockMarkSchema + goalMarkSchema", () => {
  it("rejects unknown statuses", () => {
    expect(() =>
      blockMarkSchema.parse({ blockKey: "x", status: "maybe" })
    ).toThrow();
    expect(() =>
      goalMarkSchema.parse({ goalId: "x", status: "maybe" })
    ).toThrow();
  });

  it("accepts the documented status enum", () => {
    expect(
      blockMarkSchema.parse({ blockKey: "g1:1", status: "partial" }).status
    ).toBe("partial");
    expect(
      goalMarkSchema.parse({ goalId: "g1", status: "skipped" }).status
    ).toBe("skipped");
  });
});

describe("weeklyReviewSchema", () => {
  it("fills in defaults", () => {
    const parsed = weeklyReviewSchema.parse({
      weekStart: "2026-04-27",
      timezone: "Australia/Melbourne"
    });
    expect(parsed.burchardQuestions.biggestWins).toEqual([]);
    expect(parsed.burchardQuestions.lessons).toEqual([]);
    expect(parsed.catchUpAdjustments).toEqual({});
    expect(parsed.appliedAt).toBeUndefined();
  });

  it("round-trips catch-up adjustments", () => {
    const parsed = weeklyReviewSchema.parse({
      weekStart: "2026-04-27",
      timezone: "Australia/Melbourne",
      catchUpAdjustments: { goalA: 90, goalB: -30 },
      appliedAt: 1714000000000
    });
    expect(parsed.catchUpAdjustments.goalA).toBe(90);
    expect(parsed.catchUpAdjustments.goalB).toBe(-30);
    expect(parsed.appliedAt).toBe(1714000000000);
  });
});

describe("blockKeyFor", () => {
  it("composes a stable key from goalId and startMs", () => {
    expect(blockKeyFor("goalA", 12345)).toBe("goalA:12345");
  });
});
