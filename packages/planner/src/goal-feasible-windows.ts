/**
 * Shared placement-window helpers for Pass 3 and stacked “feasible envelope” mode.
 */

import type { WeeklyGoal } from "@margot/schema";
import type { DayOfWeek } from "@margot/schema";
import {
  effectivePlacementIdealAfterBoundary,
  effectivePlacementIdealBeforeBoundary,
  normaliseGoalTime
} from "@margot/schema";
import type { Interval } from "./types";
import { mergeIntervals } from "./intervals";
import { QUANTUM } from "./weekly-grid";
import { dateKeyInTz, localMidnightMs } from "./time";

const MS_PER_MIN = 60_000;

/**
 * Keep the earliest contiguous slice of feasibility up to a wall-time budget
 * (same ordering as greedy Pass‑3 gap walks).
 */
function clipIntervalsToCumulativeDurationMs(intervals: readonly Interval[], maxMs: number): Interval[] {
  if (maxMs <= 0 || intervals.length === 0) return [];
  let remaining = maxMs;
  const out: Interval[] = [];
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  for (const iv of sorted) {
    if (remaining <= 0) break;
    const dur = iv.endMs - iv.startMs;
    if (dur <= 0) continue;
    const take = Math.min(dur, remaining);
    out.push({ startMs: iv.startMs, endMs: iv.startMs + take });
    remaining -= take;
  }
  return mergeIntervals(out);
}

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

/**
 * When **only one** of ideal after / before is set, stacked envelopes intersect this band.
 * Pass 3 uses the same geometry via {@link placementWindowsForDay} (hard clip); listed
 * ideal clock rows remain placement **nudges** inside that band when present.
 *
 * Returns null when both sides are set (paired band is applied inside {@link placementWindowsForDay})
 * or when neither side is set.
 */
export function dayPlacementIdealSingleSidedBand(
  goal: WeeklyGoal,
  dayStartMs: number,
  dayEndMs: number,
  tz: string
): Interval | null {
  const after = effectivePlacementIdealAfterBoundary(goal);
  const before = effectivePlacementIdealBeforeBoundary(goal);
  if (after && before) return null;
  if (!after && !before) return null;

  const dk = dateKeyInTz(dayStartMs, tz);
  const segs = dk.split("-");
  const ys = Number(segs[0]);
  const mo = Number(segs[1]);
  const da = Number(segs[2]);
  if (!Number.isFinite(ys) || !Number.isFinite(mo) || !Number.isFinite(da)) return null;
  const dayMid = localMidnightMs(ys, mo, da, tz);

  // Before-only: feasible time from local midnight up to (exclusive) the before boundary.
  if (!after && before) {
    const endMin = before.hour * 60 + before.minute;
    const bandEnd = Math.min(dayMid + endMin * MS_PER_MIN, dayEndMs);
    const bandStart = Math.max(dayStartMs, dayMid);
    if (bandEnd <= bandStart) return null;
    return { startMs: bandStart, endMs: bandEnd };
  }

  // After-only: feasible time from (inclusive) the after boundary through end of this planner day.
  if (after && !before) {
    const startMin = after.hour * 60 + after.minute;
    const bandStart = Math.max(dayStartMs, dayMid + startMin * MS_PER_MIN);
    const bandEnd = dayEndMs;
    if (bandEnd <= bandStart) return null;
    return { startMs: bandStart, endMs: bandEnd };
  }

  return null;
}

/** Intersects intervals with {@link dayPlacementIdealSingleSidedBand} when that band exists. */
export function clipIntervalsToPlacementIdealSingleSidedBands(
  intervals: readonly Interval[],
  dayStartMs: number,
  dayEndMs: number,
  goal: WeeklyGoal,
  tz: string
): Interval[] {
  const band = dayPlacementIdealSingleSidedBand(goal, dayStartMs, dayEndMs, tz);
  if (!band) return [...intervals];
  return intersectWithAvailability(intervals as Interval[], [band], dayStartMs, dayEndMs);
}

/** Intersects free gaps with invert/nice-weather layers, paired hard ideal windows, then single-sided ideal after/before bands (aligned with stacked feasibility). */
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
  const singleSidedIdeal = dayPlacementIdealSingleSidedBand(goal, dayStartMs, dayEndMs, tz);
  if (singleSidedIdeal) {
    gaps = intersectWithAvailability(gaps, [singleSidedIdeal], dayStartMs, dayEndMs);
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
  /** Hard ideal-window weekly ceilings from Pass‑1/2 prep (`QUANTUM`-quantised minutes); merged with `normaliseGoalTime` weekly max. */
  hardWindowWeeklyCaps?: ReadonlyMap<string, number>;
}): Record<string, Interval[]> {
  const out: Record<string, Interval[]> = {};

  for (const goal of opts.goals) {
    const norm = normaliseGoalTime(goal);
    let weeklyCapMin = norm.maxMinutesPerWeek;
    const hw = opts.hardWindowWeeklyCaps?.get(goal.id);
    if (hw !== undefined) {
      const qc = Math.max(0, Math.floor(hw / QUANTUM) * QUANTUM);
      weeklyCapMin = weeklyCapMin === undefined ? qc : Math.min(weeklyCapMin, qc);
    }
    const dailyCapMin = norm.maxMinutesPerDay;

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
      windows = clipIntervalsToPlacementIdealSingleSidedBands(
        windows,
        day.startMs,
        day.endMs,
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

      windows = mergeIntervals(windows);
      if (dailyCapMin !== undefined) {
        windows = clipIntervalsToCumulativeDurationMs(windows, dailyCapMin * MS_PER_MIN);
      }

      for (const w of windows) {
        const s = Math.max(w.startMs, opts.weekStartMs);
        const e = Math.min(w.endMs, opts.weekEndMs);
        if (e > s) chunks.push({ startMs: s, endMs: e });
      }
    }
    let merged = mergeIntervals(chunks);
    if (weeklyCapMin !== undefined) {
      merged = clipIntervalsToCumulativeDurationMs(merged, weeklyCapMin * MS_PER_MIN);
    }
    out[goal.id] = merged;
  }
  return out;
}
