/**
 * Non-negotiable minimum scheduling — Pass 3a reservation ordering + helpers for
 * busy-day overlays (calendar read-only overlaps).
 */

import type { NormalisedGoalTime, SchedulerFrameworkInclusion, WeeklyGoal } from "@calendar-automations/schema";
import { mergeIntervals } from "./intervals";
import { clipIntervalsToGoalLocalHourWindow, placementWindowsForDay } from "./goal-feasible-windows";
import { isTravelLikeConflictTitle } from "./sleep";
import { dateKeyInTz, localMidnightMs } from "./time";
import type { BusyEvent, Interval } from "./types";

const MS_PER_MIN = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const DAY_INDEX: Record<
  "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday",
  number
> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6
};

/** Prepared goal subset for ordering without importing {@link PreparedGoal}. */
export interface MinimumFirstPreparedLike {
  goal: WeeklyGoal;
  norm: NormalisedGoalTime;
  effectiveMinutes: number;
  index: number;
  weeklyFloorBeforeCatchUpBump: number;
}

function commitmentTierRank(level: WeeklyGoal["commitmentLevel"] | undefined): number {
  switch (level) {
    case "non_negotiable":
      return 0;
    case "nice_to_have":
      return 2;
    default:
      return 1;
  }
}

function compareGoalsNiceWeatherPassthrough(a: WeeklyGoal, b: WeeklyGoal): number {
  const aNw = a.scheduleInNiceWeather === true ? 0 : 1;
  const bNw = b.scheduleInNiceWeather === true ? 0 : 1;
  return aNw - bNw;
}

/**
 * Pass 3a ordering: commitment tiers apply whenever non‑negotiable minimums mode is enabled
 * (independent of `schedulerFrameworkInclusion.commitment`); daily NN mins before weekly-only NN;
 * then mirrors {@link comparePreparedGoalsForPass3Placement} floor / gym tier / nice‑weather /
 * index / demand ties.
 */
export function comparePreparedGoalsForMinimumFirstReservation(
  a: MinimumFirstPreparedLike,
  b: MinimumFirstPreparedLike,
  _fw: SchedulerFrameworkInclusion
): number {
  const tr =
    commitmentTierRank(a.goal.commitmentLevel) - commitmentTierRank(b.goal.commitmentLevel);
  if (tr !== 0) return tr;
  const aSpec = deriveNnReservationSpec(a.goal, a.norm);
  const bSpec = deriveNnReservationSpec(b.goal, b.norm);
  const aDailyRank = aSpec.dailyNn ? 0 : aSpec.weeklyNn ? 1 : 2;
  const bDailyRank = bSpec.dailyNn ? 0 : bSpec.weeklyNn ? 1 : 2;
  if (aDailyRank !== bDailyRank) return aDailyRank - bDailyRank;
  const aHasFloor = a.weeklyFloorBeforeCatchUpBump > 0 ? 0 : 1;
  const bHasFloor = b.weeklyFloorBeforeCatchUpBump > 0 ? 0 : 1;
  if (aHasFloor !== bHasFloor) return aHasFloor - bHasFloor;
  const aGym = a.goal.specialGoalType === "gym" ? 0 : 1;
  const bGym = b.goal.specialGoalType === "gym" ? 0 : 1;
  if (aGym !== bGym) return aGym - bGym;
  const nwCmp = compareGoalsNiceWeatherPassthrough(a.goal, b.goal);
  if (nwCmp !== 0) return nwCmp;
  if (a.index !== b.index) return a.index - b.index;
  return b.effectiveMinutes - a.effectiveMinutes;
}

export interface NnReservationSpec {
  active: boolean;
  weeklyNn: boolean;
  dailyNn: boolean;
}

export function deriveNnReservationSpec(goal: WeeklyGoal, norm: NormalisedGoalTime): NnReservationSpec {
  const tierNn = goal.commitmentLevel === "non_negotiable";
  const hasWeekly = norm.minMinutesPerWeek !== undefined;
  const hasDaily = norm.minMinutesPerDay !== undefined;
  const weeklyNn =
    hasWeekly && (tierNn || goal.minMinutesPerWeekNonNegotiable === true);
  const dailyNn =
    hasDaily && (tierNn || goal.minMinutesPerDayNonNegotiable === true);
  return { active: weeklyNn || dailyNn, weeklyNn, dailyNn };
}

export function deriveBusyOverlayMinimumEligible(_goal: WeeklyGoal, norm: NormalisedGoalTime): boolean {
  return norm.minMinutesPerWeek !== undefined || norm.minMinutesPerDay !== undefined;
}

function loggedGoalBusyMinutesForDay(
  busy: readonly BusyEvent[],
  goalId: string,
  dayStartMs: number,
  dayEndMs: number
): number {
  const prefix = `daysheet-goal:${goalId}:`;
  let total = 0;
  for (const ev of busy) {
    if (!ev.sourceId?.startsWith(prefix)) continue;
    const startMs = Math.max(ev.startMs, dayStartMs);
    const endMs = Math.min(ev.endMs, dayEndMs);
    if (endMs <= startMs) continue;
    total += Math.floor((endMs - startMs) / MS_PER_MIN);
  }
  return total;
}

function clipInterval(iv: Interval, windowStartMs: number, windowEndMs: number): Interval | null {
  const startMs = Math.max(iv.startMs, windowStartMs);
  const endMs = Math.min(iv.endMs, windowEndMs);
  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

export function mergedGoalAchievementMinutesWeek(
  goalId: string,
  busy: readonly BusyEvent[],
  blocks: readonly { segment?: boolean; goalId: string; startMs: number; endMs: number }[],
  weekStartMs: number,
  weekEndMs: number
): number {
  const raw: Interval[] = [];
  const prefix = `daysheet-goal:${goalId}:`;
  for (const ev of busy) {
    if (!ev.sourceId?.startsWith(prefix)) continue;
    const c = clipInterval({ startMs: ev.startMs, endMs: ev.endMs }, weekStartMs, weekEndMs);
    if (c) raw.push(c);
  }
  for (const b of blocks) {
    if (b.segment || b.goalId !== goalId) continue;
    const c = clipInterval({ startMs: b.startMs, endMs: b.endMs }, weekStartMs, weekEndMs);
    if (c) raw.push(c);
  }
  const sorted = [...raw].sort((a, x) => a.startMs - x.startMs);
  if (sorted.length === 0) return 0;
  let cur = sorted[0]!;
  let acc = 0;
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (n.startMs <= cur.endMs) {
      cur = { startMs: cur.startMs, endMs: Math.max(cur.endMs, n.endMs) };
    } else {
      acc += Math.floor((cur.endMs - cur.startMs) / MS_PER_MIN);
      cur = n;
    }
  }
  acc += Math.floor((cur.endMs - cur.startMs) / MS_PER_MIN);
  return acc;
}

export function goalAllowedDayIndexes(goal: WeeklyGoal): readonly number[] {
  if (goal.daysOfWeek && goal.daysOfWeek.length > 0) {
    return goal.daysOfWeek.map((d) => DAY_INDEX[d]);
  }
  if (goal.dayOfWeek) return [DAY_INDEX[goal.dayOfWeek]];
  return [0, 1, 2, 3, 4, 5, 6];
}

export function reservationBudgetMinutes(opts: {
  prepared: MinimumFirstPreparedLike;
  busy: readonly BusyEvent[];
  blocks: readonly { segment?: boolean; goalId: string; startMs: number; endMs: number }[];
  days: readonly { startMs: number; endMs: number }[];
  weekStartMs: number;
  weekEndMs: number;
  spec: NnReservationSpec;
}): number {
  const { prepared, busy, blocks, days, weekStartMs, weekEndMs, spec } = opts;
  if (!spec.active || prepared.effectiveMinutes <= 0) return 0;
  const gid = prepared.goal.id;
  const norm = prepared.norm;
  let cap = prepared.effectiveMinutes;
  const allowedDays = goalAllowedDayIndexes(prepared.goal);

  const achievedWeek = mergedGoalAchievementMinutesWeek(
    gid,
    busy,
    blocks,
    weekStartMs,
    weekEndMs
  );
  if (spec.weeklyNn && norm.minMinutesPerWeek !== undefined) {
    const weeklyUnmet = Math.max(0, norm.minMinutesPerWeek - achievedWeek);
    cap = Math.min(cap, weeklyUnmet);
  }

  let dailySum = 0;
  if (spec.dailyNn && norm.minMinutesPerDay !== undefined) {
    const minDaily = norm.minMinutesPerDay;
    for (const dayIdx of allowedDays) {
      const day = days[dayIdx];
      if (!day) continue;
      let placedDay = 0;
      for (const b of blocks) {
        if (b.segment || b.goalId !== gid) continue;
        const s = Math.max(b.startMs, day.startMs);
        const e = Math.min(b.endMs, day.endMs);
        if (e > s) placedDay += Math.floor((e - s) / MS_PER_MIN);
      }
      const logDay = loggedGoalBusyMinutesForDay(busy, gid, day.startMs, day.endMs);
      dailySum += Math.max(0, minDaily - (placedDay + logDay));
    }
    cap = Math.min(cap, dailySum);
  }

  return Math.max(0, cap);
}

export function multiDayHeavyBusyDayIndexes(
  busy: readonly BusyEvent[],
  weekStartMs: number,
  weekEndMs: number,
  tz: string
): Set<number> {
  const out = new Set<number>();
  for (const ev of busy) {
    if (!ev.busy) continue;
    const cs = Math.max(ev.startMs, weekStartMs);
    const ce = Math.min(ev.endMs, weekEndMs);
    if (ce <= cs) continue;
    const clippedDur = ce - cs;
    const crossesLocalDate = dateKeyInTz(cs, tz) !== dateKeyInTz(ce - 1, tz);
    const longClip = clippedDur >= DAY_MS - MS_PER_MIN;
    if (!(crossesLocalDate || longClip)) continue;
    for (let d = 0; d < 7; d++) {
      const ds = weekStartMs + d * DAY_MS;
      const de = ds + DAY_MS;
      const s = Math.max(cs, ds);
      const e = Math.min(ce, de);
      if (e > s) out.add(d);
    }
  }
  return out;
}

export function subtractIntervalsBounded(base: readonly Interval[], minus: readonly Interval[]): Interval[] {
  if (minus.length === 0) return mergeIntervals(base);
  const mergedMinus = mergeIntervals(minus);
  let parts = mergeIntervals(base);
  for (const m of mergedMinus) {
    const next: Interval[] = [];
    for (const p of parts) {
      if (m.endMs <= p.startMs || m.startMs >= p.endMs) {
        next.push(p);
        continue;
      }
      if (m.startMs > p.startMs)
        next.push({ startMs: p.startMs, endMs: Math.min(m.startMs, p.endMs) });
      if (m.endMs < p.endMs)
        next.push({ startMs: Math.max(m.endMs, p.startMs), endMs: p.endMs });
    }
    parts = next.filter((x) => x.endMs > x.startMs);
  }
  return mergeIntervals(parts);
}

/** Goal cloned for overlays: skips nice‑weather narrowing so heavy travel days remain placeable. */
export function goalForBusyOverlayPlacement(goal: WeeklyGoal): WeeklyGoal {
  return { ...goal, scheduleInNiceWeather: false };
}

export function overlayPlacementLegalWindows(opts: {
  dayStartMs: number;
  dayEndMs: number;
  goal: WeeklyGoal;
  tz: string;
  availabilityWindows?: readonly Interval[] | undefined;
}): Interval[] {
  const syntheticGap: Interval = { startMs: opts.dayStartMs, endMs: opts.dayEndMs };
  const overlayGoal = goalForBusyOverlayPlacement(opts.goal);
  let out = placementWindowsForDay(
    [syntheticGap],
    opts.dayStartMs,
    opts.dayEndMs,
    opts.availabilityWindows,
    undefined,
    overlayGoal,
    opts.tz
  );
  out = clipIntervalsToGoalLocalHourWindow(out, opts.dayStartMs, opts.dayEndMs, overlayGoal, opts.tz);
  return mergeIntervals(out);
}

export function intersectIntervals(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const s = Math.max(x.startMs, y.startMs);
      const e = Math.min(x.endMs, y.endMs);
      if (e > s) out.push({ startMs: s, endMs: e });
    }
  }
  return mergeIntervals(out);
}

export function mergedBusyIntervalsNonDriveDay(
  busy: readonly BusyEvent[],
  dayStartMs: number,
  dayEndMs: number
): Interval[] {
  const raw: Interval[] = [];
  for (const ev of busy) {
    if (!ev.busy) continue;
    const title = ev.title.trim();
    if (isTravelLikeConflictTitle(title)) continue;
    const clipped = clipInterval({ startMs: ev.startMs, endMs: ev.endMs }, dayStartMs, dayEndMs);
    if (!clipped) continue;
    const dur = clipped.endMs - clipped.startMs;
    if (dur > DAY_MS + MS_PER_MIN) continue;
    raw.push(clipped);
  }
  return mergeIntervals(raw);
}

export function morningFallbackInterval(
  dayStartMs: number,
  dayEndMs: number,
  fallbackHour: number,
  durationMs: number,
  tz: string
): Interval | null {
  const dk = dateKeyInTz(dayStartMs, tz);
  const segs = dk.split("-").map(Number);
  const ys = segs[0]!;
  const mo = segs[1]!;
  const da = segs[2]!;
  if (!Number.isFinite(ys) || !Number.isFinite(mo) || !Number.isFinite(da)) return null;
  const dayMid = localMidnightMs(ys, mo, da, tz);
  let startMs = dayMid + fallbackHour * 3600 * 1000;
  let endMs = startMs + durationMs;
  if (endMs > dayEndMs) {
    endMs = dayEndMs;
    startMs = endMs - durationMs;
    if (startMs < dayStartMs) startMs = dayStartMs;
  }
  if (endMs <= startMs) return null;
  return {
    startMs: Math.max(startMs, dayStartMs),
    endMs: Math.min(endMs, dayEndMs)
  };
}

export function subtractSleepFromIntervals(
  windows: Interval[],
  sleepIntervals: readonly Interval[] | undefined,
  dayStartMs: number,
  dayEndMs: number
): Interval[] {
  if (!sleepIntervals?.length) return windows;
  const clippedSleep: Interval[] = [];
  for (const s of sleepIntervals) {
    const c = clipInterval(s, dayStartMs, dayEndMs);
    if (c) clippedSleep.push(c);
  }
  if (clippedSleep.length === 0) return windows;
  return subtractIntervalsBounded(windows, clippedSleep);
}

export function subtractSegmentBlocksFromIntervals(
  windows: Interval[],
  segmentBlocks: readonly { segment?: boolean; startMs: number; endMs: number }[],
  dayStartMs: number,
  dayEndMs: number
): Interval[] {
  const segs = segmentBlocks
    .filter((b) => b.segment)
    .map((b) => clipInterval(b, dayStartMs, dayEndMs))
    .filter((x): x is Interval => x !== null);
  if (segs.length === 0) return windows;
  return subtractIntervalsBounded(windows, segs);
}

export function nnOverlayAuthoredEligible(goal: WeeklyGoal, norm: NormalisedGoalTime): boolean {
  const spec = deriveNnReservationSpec(goal, norm);
  if (spec.active) return true;
  return deriveBusyOverlayMinimumEligible(goal, norm);
}

export function freeGapMinutesBestOnDay(day: { gaps: Interval[] }, nowMs: number | undefined): number {
  let maxLen = 0;
  for (const g of day.gaps) {
    const s = nowMs === undefined ? g.startMs : Math.max(g.startMs, nowMs);
    const e = g.endMs;
    if (e <= s) continue;
    maxLen = Math.max(maxLen, Math.floor((e - s) / MS_PER_MIN));
  }
  return maxLen;
}
