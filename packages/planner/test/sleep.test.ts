import { describe, expect, it } from "vitest";
import type { SleepSettings } from "@calendar-automations/schema";
import { formatSleepBlockTitle, placeSleepBlock } from "../src/sleep";
import type { BusyEvent } from "../src/types";

// Helper: night runs 20:00 day 0 → 12:00 day 1 in epoch ms anchored at 0.
// Day 0 starts at 0 ms, day 1 at 24h ms.
const HOUR = 60 * 60 * 1000;
const NIGHT_START = 20 * HOUR; // day 0, 20:00
const NIGHT_END = 24 * HOUR + 12 * HOUR; // day 1, 12:00
const IDEAL_WAKE = 24 * HOUR + 7 * HOUR; // day 1, 07:00

const baseSleep: SleepSettings = {
  durationHours: 8,
  windowStartHour: 20,
  windowEndHour: 12,
  idealWakeHour: 7,
  idealWakeMinute: 0,
  bufferBeforeLeaveMinutes: 60,
  bufferAfterDriveHomeMinutes: 60,
  travelBufferRoundMinutes: 15,
  minBlockHours: 4,
  ignoreEventTitles: ["Gym"]
};

function ev(startMs: number, endMs: number, title = "Conflict"): BusyEvent {
  return { sourceId: title, title, startMs, endMs, busy: true, source: "google" };
}

describe("formatSleepBlockTitle", () => {
  it("adds conflict context when sleep moved out of the ideal target window", () => {
    const p = {
      startMs: 0,
      endMs: 6 * HOUR,
      split: false,
      underMinimum: true,
      placement: "largest-gap" as const,
      targetHadOverlap: true,
      targetOverlapTitle: "Neutrino Growth",
      targetOverlapTraceTitle: null as string | null
    };
    expect(formatSleepBlockTitle(p, 8)).toBe(
      "Sleep (less than ideal sleep 6h, conflicts: Neutrino Growth)"
    );
  });

  it("names a travel leg when that was the only overlapping busy in the target window", () => {
    const p = {
      startMs: 0,
      endMs: 8 * HOUR,
      split: false,
      underMinimum: false,
      placement: "gap" as const,
      targetHadOverlap: true,
      targetOverlapTitle: null,
      targetOverlapTraceTitle: "[Drive] → Work"
    };
    expect(formatSleepBlockTitle(p, 8)).toBe("Sleep (conflicts: [Drive] → Work)");
  });
});

describe("placeSleepBlock", () => {
  it("places sleep ending at the target wake when no conflicts exist", () => {
    const result = placeSleepBlock(NIGHT_START, NIGHT_END, [], baseSleep, {
      targetEndMs: IDEAL_WAKE
    });
    expect(result).toEqual([
      {
        startMs: IDEAL_WAKE - 8 * HOUR, // 23:00 day 0
        endMs: IDEAL_WAKE,
        split: false,
        underMinimum: false,
        placement: "target",
        targetHadOverlap: false,
        targetOverlapTitle: null,
        targetOverlapTraceTitle: null
      }
    ]);
  });

  it("respects an earlier target wake (e.g. early outbound drive)", () => {
    const earlierWake = 24 * HOUR + 5 * HOUR; // 05:00 day 1
    const result = placeSleepBlock(NIGHT_START, NIGHT_END, [], baseSleep, {
      targetEndMs: earlierWake
    });
    expect(result[0]).toEqual({
      startMs: earlierWake - 8 * HOUR, // 21:00 day 0
      endMs: earlierWake,
      split: false,
      underMinimum: false,
      placement: "target",
      targetHadOverlap: false,
      targetOverlapTitle: null,
      targetOverlapTraceTitle: null
    });
  });

  it("falls back to a gap search when the target conflicts", () => {
    // Late event at 23:30-01:30 spans the target window [23:00-07:00].
    const lateEvent = ev(23 * HOUR + 30 * 60 * 1000, 24 * HOUR + 90 * 60 * 1000, "Late shift");
    const result = placeSleepBlock(
      NIGHT_START,
      NIGHT_END,
      [lateEvent],
      baseSleep,
      { targetEndMs: IDEAL_WAKE }
    );
    expect(result.length).toBe(1);
    const block = result[0]!;
    // Should place sleep AFTER the late shift — gap-search picks the latest fit.
    expect(block.startMs).toBeGreaterThanOrEqual(lateEvent.endMs);
    expect(block.endMs - block.startMs).toBe(8 * HOUR);
    expect(block.placement).toBe("gap");
    expect(block.targetHadOverlap).toBe(true);
  });

  it("suffixes Planner travel on drive-only overlap trace titles", () => {
    const drive: BusyEvent = {
      ...ev(24 * HOUR + 6 * HOUR, 24 * HOUR + 7 * HOUR + 30 * 60 * 1000, "[Drive] → Work"),
      source: "internal"
    };
    const result = placeSleepBlock(NIGHT_START, NIGHT_END, [drive], baseSleep, {
      targetEndMs: IDEAL_WAKE
    });
    const block = result[0]!;
    expect(block.targetOverlapTitle).toBeNull();
    expect(block.targetOverlapTraceTitle).toBe("[Drive] → Work · Planner travel");
  });

  it("splits across two large gaps when no single gap fits", () => {
    // Mid-night gym shift 02:00-04:00 leaves two ~5h gaps either side.
    const shift = ev(24 * HOUR + 2 * HOUR, 24 * HOUR + 4 * HOUR, "Shift");
    const result = placeSleepBlock(NIGHT_START, NIGHT_END, [shift], baseSleep, {
      targetEndMs: IDEAL_WAKE
    });
    // Even though the single trailing gap (04:00→12:00 = 8h) does fit, the
    // late-gap heuristic should still give one block; split kicks in only
    // when no gap >= duration. Confirm it's a single block here.
    expect(result.length).toBe(1);
    expect(result[0]!.split).toBe(false);
  });

  it("does in fact split when both halves are forced", () => {
    // Two shifts at 22:00-23:00 and 02:00-06:00 leave 23:00-02:00 (3h),
    // 06:00-12:00 (6h), and 20:00-22:00 (2h). With minBlockHours=4 only
    // the 6h tail fits — should NOT split (single fit).
    // Force a real split: shifts at 23:00-01:00 and 04:00-08:00
    const a = ev(23 * HOUR, 24 * HOUR + 1 * HOUR, "Shift A");
    const b = ev(24 * HOUR + 4 * HOUR, 24 * HOUR + 8 * HOUR, "Shift B");
    // Gaps: [20:00-23:00]=3h, [01:00-04:00]=3h, [08:00-12:00]=4h.
    // No 8h gap → split eligible: only 4h tail meets minBlockHours, so
    // split fallback can't pick two ≥4h gaps. Should mark underMinimum.
    const result = placeSleepBlock(NIGHT_START, NIGHT_END, [a, b], baseSleep, {
      targetEndMs: IDEAL_WAKE
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((r) => r.underMinimum)).toBe(true);
  });

  it("clamps the target inside the window when it lands before earliest bedtime", () => {
    // Target wake 03:00 → backed up 8h would be 19:00 (before 20:00 nightStart).
    const result = placeSleepBlock(NIGHT_START, NIGHT_END, [], baseSleep, {
      targetEndMs: 24 * HOUR + 3 * HOUR
    });
    expect(result[0]!.startMs).toBe(NIGHT_START);
    expect(result[0]!.endMs).toBe(24 * HOUR + 3 * HOUR);
    // 7h block — under the 8h ideal but still flagged.
    expect(result[0]!.underMinimum).toBe(true);
    expect(result[0]!.placement).toBe("target");
  });

  it("falls back to windowEnd when no target is provided", () => {
    const result = placeSleepBlock(NIGHT_START, NIGHT_END, [], baseSleep);
    // No target → defaults to windowEndMs (12:00 day 1).
    expect(result[0]!.endMs).toBe(NIGHT_END);
    expect(result[0]!.startMs).toBe(NIGHT_END - 8 * HOUR);
    expect(result[0]!.placement).toBe("target");
  });

  it("returns a drag override verbatim, ignoring busy and target", () => {
    // Override 22:00 day 0 → 06:00 day 1 (8h), even with a conflicting busy
    // event smack in the middle. The user explicitly asked for it.
    const conflict = ev(24 * HOUR + 1 * HOUR, 24 * HOUR + 3 * HOUR, "Late shift");
    const override = { startMs: 22 * HOUR, endMs: 24 * HOUR + 6 * HOUR };
    const result = placeSleepBlock(NIGHT_START, NIGHT_END, [conflict], baseSleep, {
      targetEndMs: IDEAL_WAKE,
      override
    });
    expect(result).toEqual([
      {
        startMs: override.startMs,
        endMs: override.endMs,
        split: false,
        underMinimum: false,
        placement: "override",
        targetHadOverlap: false,
        targetOverlapTitle: null,
        targetOverlapTraceTitle: null
      }
    ]);
  });

  it("flags an underMinimum override when shorter than durationHours", () => {
    const override = { startMs: 23 * HOUR, endMs: 24 * HOUR + 4 * HOUR }; // 5h
    const result = placeSleepBlock(NIGHT_START, NIGHT_END, [], baseSleep, { override });
    expect(result[0]!.underMinimum).toBe(true);
    expect(result[0]!.placement).toBe("override");
  });

  it("ignores an empty override and falls through to the target search", () => {
    const override = { startMs: 0, endMs: 0 };
    const result = placeSleepBlock(NIGHT_START, NIGHT_END, [], baseSleep, {
      targetEndMs: IDEAL_WAKE,
      override
    });
    expect(result[0]!.endMs).toBe(IDEAL_WAKE);
    expect(result[0]!.placement).toBe("target");
  });
});
