import { describe, expect, it } from "vitest";
import type { BusyEvent } from "@calendar-automations/planner";
import {
  approximateRollingSevenDayOccupancy,
  daySheetLoggedMinutesByGoalInWindow,
  rollingSevenDayOffsetsFromWeekStart,
  rollingSevenDayWindowBounds,
  rollingSpansTwoIsoWeeks,
  touchedSliceIndexesForRollingWindow
} from "./rolling-seven-day-plan-stats";

describe("rolling seven day plan stats", () => {
  const tz = "UTC";
  const weekStartMs = Date.UTC(1970, 1, 2, 0, 0, 0); // Monday

  it("offsets start Wednesday when anchored that weekday", () => {
    const wedMidday = Date.UTC(1970, 1, 4, 12, 0, 0);
    const offs = rollingSevenDayOffsetsFromWeekStart(weekStartMs, tz, wedMidday);
    expect(offs[0]).toBe(2);
    expect(offs).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it("rollingSpansTwoIsoWeeks crosses Monday within the strip", () => {
    const wed = Date.UTC(1970, 1, 4, 12, 0, 0);
    expect(rollingSpansTwoIsoWeeks(weekStartMs, tz, wed)).toBe(true);
  });

  it("does not span two ISO weeks starting Monday", () => {
    const monday = Date.UTC(1970, 1, 2, 8, 0, 0);
    const offs = rollingSevenDayOffsetsFromWeekStart(weekStartMs, tz, monday);
    expect(offs.every((d) => d <= 6)).toBe(true);
    expect(rollingSpansTwoIsoWeeks(weekStartMs, tz, monday)).toBe(false);
  });

  it("rolling window spans exactly seven days gross", () => {
    const monday = Date.UTC(1970, 1, 2, 8, 0, 0);
    const { windowStartMs, windowEndMs } = rollingSevenDayWindowBounds(weekStartMs, tz, monday);
    const grossMin = Math.round((windowEndMs - windowStartMs) / 60_000);
    expect(grossMin).toBe(7 * 24 * 60);
  });

  it("approximateRollingSevenDayOccupancy subtracts overlapping busy intervals", () => {
    const { windowStartMs, windowEndMs } = rollingSevenDayWindowBounds(
      weekStartMs,
      tz,
      Date.UTC(1970, 1, 2, 8, 0, 0)
    );
    const busy: BusyEvent[] = [
      {
        sourceId: "x",
        title: "meet",
        startMs: windowStartMs,
        endMs: windowStartMs + 2 * 60 * 60 * 1000,
        busy: true,
        source: "internal"
      }
    ];
    const r = approximateRollingSevenDayOccupancy({
      windowStartMs,
      windowEndMs,
      busy,
      daySheetGoalBusy: [],
      system: [],
      proposed: [],
      includeProposedBlocks: true
    });
    expect(r.grossWindowMinutes).toBe(7 * 24 * 60);
    expect(r.occupiedApproxMinutes).toBe(120);
    expect(Math.max(0, r.grossWindowMinutes - r.occupiedApproxMinutes)).toBe(7 * 24 * 60 - 120);
  });

  it("touchedSliceIndexes spans two horizons when rolling crosses weeks", () => {
    const { windowStartMs, windowEndMs } = rollingSevenDayWindowBounds(
      weekStartMs,
      tz,
      Date.UTC(1970, 1, 4, 12, 0, 0)
    );
    const isoStarts = [weekStartMs, weekStartMs + 7 * 24 * 60 * 60 * 1000];
    const idx = touchedSliceIndexesForRollingWindow(isoStarts, windowStartMs, windowEndMs);
    expect(idx).toEqual([0, 1]);
  });

  it("daySheetLoggedMinutesByGoalInWindow clips and merges overlaps", () => {
    const { windowStartMs, windowEndMs } = rollingSevenDayWindowBounds(
      weekStartMs,
      tz,
      Date.UTC(1970, 1, 2, 10, 0, 0)
    );
    const base = windowStartMs + 3600 * 1000;
    const daySheetGoalBusy = [
      {
        sourceId: `daysheet-goal:G1:${base}:${base + 120 * 60_000}`,
        title: "x",
        startMs: base,
        endMs: base + 120 * 60_000,
        busy: true,
        source: "internal" as const
      },
      {
        sourceId: `daysheet-goal:G1:${base + 90 * 60_000}:${base + 210 * 60_000}`,
        title: "x",
        startMs: base + 90 * 60_000,
        endMs: base + 210 * 60_000,
        busy: true,
        source: "internal" as const
      }
    ] satisfies BusyEvent[];
    const byGoal = daySheetLoggedMinutesByGoalInWindow(daySheetGoalBusy, windowStartMs, windowEndMs);
    expect(byGoal.G1).toBe(210);
  });
});
