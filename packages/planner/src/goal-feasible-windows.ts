/**
 * Shared placement-window helpers for Pass 3 and stacked “feasible envelope” mode.
 */

import type { WeeklyGoal } from "@calendar-automations/schema";
import type { DayOfWeek } from "@calendar-automations/schema";
import {
  effectivePlacementIdealAfterBoundary,
  effectivePlacementIdealBeforeBoundary
} from "@calendar-automations/schema";
import type { Interval } from "./types";
import { mergeIntervals } from "./intervals";
import { dateKeyInTz, localMidnightMs } from "./time";

const MS_PER_MIN = 60_000;

const DAY_INDEX: Record<DayOfWeek, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6
};

/** Intersect free gaps with calendar availability windows clipped to one ISO day. */
export function intersectWithAvailability(
  gaps: readonly Interval[],
  availabilityWindows: readonly Interval[],
  dayStartMs: number,
  dayEndMs: number
): Interval[] {
  const dayWindows = availabilityWindows.filter(
    (w) => w.endMs > dayStartMs && w.startMs < dayEndMs
  );
  if (dayWindows.length === 0) return [];
  const out: Interval[] = [];
  for (const gap of gaps) {
    for (const window of dayWindows) {
      const startMs = Math.max(gap.startMs, window.startMs);
      const endMs = Math.min(gap.endMs, window.endMs);
      if (endMs > startMs) out.push({ startMs, endMs });
    }
  }
  return out;
}

/**
 * When both after and before local boundaries are set (and before is strictly later than after),
 * placement is restricted to free time inside that wall-clock window on this calendar day.
 */
export function dayHardPlacementIdealWindow(
  goal: WeeklyGoal,
  dayStartMs: number,
  tz: string
): Interval | null {
  const after = effectivePlacementIdealAfterBoundary(goal);
  const before = effectivePlacementIdealBeforeBoundary(goal);
  if (!after || !before) return null;
  const startMin = after.hour * 60 + after.minute;
  const endMin = before.hour * 60 + before.minute;
  if (endMin <= startMin) return null;
  const dk = dateKeyInTz(dayStartMs, tz);
  const segs = dk.split("-");
  const ys = Number(segs[0]);
  const mo = Number(segs[1]);
  const da = Number(segs[2]);
  if (!Number.isFinite(ys) || !Number.isFinite(mo) || !Number.isFinite(da)) return null;
  const dayMid = localMidnightMs(ys, mo, da, tz);
  return {
    startMs: dayMid + startMin * MS_PER_MIN,
    endMs: dayMid + endMin * MS_PER_MIN
  };
}

/** Intersects free gaps with optional invert-calendar windows, then nice-weather outside windows. */
export function placementWindowsForDay(
  dayGaps: readonly Interval[],
  dayStartMs: number,
  dayEndMs: number,
  availabilityWindows: readonly Interval[] | undefined,
  niceWeatherWindows: readonly Interval[] | undefined,
  goal: WeeklyGoal,
  tz: string
): Interval[] {
  let gaps: Interval[] = dayGaps as Interval[];
  if (availabilityWindows && availabilityWindows.length > 0) {
    gaps = intersectWithAvailability(gaps, availabilityWindows, dayStartMs, dayEndMs);
  }
  if (
    goal.scheduleInNiceWeather === true &&
    niceWeatherWindows &&
    niceWeatherWindows.length > 0
  ) {
    gaps = intersectWithAvailability(gaps, niceWeatherWindows, dayStartMs, dayEndMs);
  }
  const idealWin = dayHardPlacementIdealWindow(goal, dayStartMs, tz);
  if (idealWin) {
    gaps = intersectWithAvailability(gaps, [idealWin], dayStartMs, dayEndMs);
  }
  return gaps;
}

/**
 * Clip intervals to [earliestHour, latestHour) local wall-clock band on this calendar day.
 * Mirrors Pass‑3 gap eligibility (`pickGapForGoal`) but returns precise interval intersections.
 */
export function clipIntervalsToGoalLocalHourWindow(
  intervals: readonly Interval[],
  dayStartMs: number,
  dayEndMs: number,
  goal: WeeklyGoal,
  tz: string
): Interval[] {
  const earliest = goal.earliestHour ?? 0;
  const latest = goal.latestHour ?? 24;
  if (latest <= earliest) return [];
  const dk = dateKeyInTz(dayStartMs, tz);
  const segs = dk.split("-");
  const ys = Number(segs[0]);
  const mo = Number(segs[1]);
  const da = Number(segs[2]);
  if (!Number.isFinite(ys) || !Number.isFinite(mo) || !Number.isFinite(da)) return [];
  const dayMid = localMidnightMs(ys, mo, da, tz);
  const band: Interval = {
    startMs: dayMid + earliest * 60 * MS_PER_MIN,
    endMs: dayMid + latest * 60 * MS_PER_MIN
  };
  return intersectWithAvailability(intervals as Interval[], [band], dayStartMs, dayEndMs);
}

export interface WeekDayGapBuckets {
  startMs: number;
  endMs: number;
  gaps: Interval[];
}

/**
 * Per goal: union of all intervals in the ISO week where that goal could receive Pass‑3
 * placement (free gaps ∩ invert/nice‑weather/hard‑ideal layering ∩ weekday pins ∩ hour band),
 * independent of other goals’ placements.
 */
export function computeStackedFeasibleWindowsForWeek(opts: {
  goals: readonly WeeklyGoal[];
  days: readonly WeekDayGapBuckets[];
  tz: string;
  goalAvailabilityWindows?: Record<string, Interval[]>;
  niceWeatherWindows?: readonly Interval[];
  nowMs?: number;
  weekStartMs: number;
  weekEndMs: number;
}): Record<string, Interval[]> {
  const out: Record<string, Interval[]> = {};

  for (const goal of opts.goals) {
    const allowedDays =
      goal.daysOfWeek && goal.daysOfWeek.length > 0
        ? goal.daysOfWeek.map((d) => DAY_INDEX[d])
        : goal.dayOfWeek
          ? [DAY_INDEX[goal.dayOfWeek]]
          : [0, 1, 2, 3, 4, 5, 6];

    const availabilityWindows = opts.goalAvailabilityWindows?.[goal.id];

    const chunks: Interval[] = [];
    for (const dayIdx of allowedDays) {
      const day = opts.days[dayIdx];
      if (!day) continue;

      let windows = placementWindowsForDay(
        day.gaps,
        day.startMs,
        day.endMs,
        availabilityWindows,
        opts.niceWeatherWindows,
        goal,
        opts.tz
      );
      windows = clipIntervalsToGoalLocalHourWindow(windows, day.startMs, day.endMs, goal, opts.tz);

      if (opts.nowMs !== undefined) {
        const nm = opts.nowMs;
        windows = windows
          .map((g) => ({ startMs: Math.max(g.startMs, nm), endMs: g.endMs }))
          .filter((g) => g.endMs > g.startMs);
      }

      for (const w of windows) {
        const s = Math.max(w.startMs, opts.weekStartMs);
        const e = Math.min(w.endMs, opts.weekEndMs);
        if (e > s) chunks.push({ startMs: s, endMs: e });
      }
    }
    out[goal.id] = mergeIntervals(chunks);
  }
  return out;
}
