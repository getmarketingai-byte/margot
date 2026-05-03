import type { AllocatedBlock, BusyEvent } from "@calendar-automations/planner";
import { clip, collectBusyIntervals, mergeIntervals } from "@calendar-automations/planner/intervals";
import type { SystemBlock } from "@/lib/week-blocks";

const DAYSHEET_GOAL_SOURCE_RE = /^daysheet-goal:([^:]+):/;

export const DAY_MS = 24 * 60 * 60 * 1000;

function partsInTimezone(ms: number, timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  });
  const parts = fmt.formatToParts(new Date(ms)).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday ?? ""
  };
}

/** Offset in whole days from `weekStartMs` (midnight-aligned week) to today in tz. */
export function todayOffsetFromWeekStart(weekStartMs: number, timezone: string, nowMs: number): number {
  const from = partsInTimezone(weekStartMs, timezone);
  const to = partsInTimezone(nowMs, timezone);
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / DAY_MS);
}

export function rollingSevenDayOffsetsFromWeekStart(
  weekStartMs: number,
  timezone: string,
  nowMs: number
): readonly number[] {
  const startOffset = todayOffsetFromWeekStart(weekStartMs, timezone, nowMs);
  return Array.from({ length: 7 }, (_, i) => startOffset + i);
}

/** Inclusive-exclusive window matching calendar column union for rolling 7-day view */
export function rollingSevenDayWindowBounds(
  weekStartMs: number,
  timezone: string,
  nowMs: number
): { windowStartMs: number; windowEndMs: number } {
  const startOffset = todayOffsetFromWeekStart(weekStartMs, timezone, nowMs);
  const windowStartMs = weekStartMs + startOffset * DAY_MS;
  const windowEndMs = windowStartMs + 7 * DAY_MS;
  return { windowStartMs, windowEndMs };
}

/** True when any visible offset maps past the first ISO week (Mon indexed 0–6 inside that anchor week). */
export function rollingSpansTwoIsoWeeks(
  weekStartMs: number,
  timezone: string,
  nowMs: number
): boolean {
  const offsets = rollingSevenDayOffsetsFromWeekStart(weekStartMs, timezone, nowMs);
  return offsets.some((d) => d > 6);
}

/** Which allocation slice indexes (0 = current ISO Monday week) intersect the rolling window */
export function touchedSliceIndexesForRollingWindow(
  isoWeekStartsMs: readonly number[],
  windowStartMs: number,
  windowEndMs: number
): number[] {
  const out: number[] = [];
  for (let i = 0; i < isoWeekStartsMs.length; i++) {
    const ws = isoWeekStartsMs[i]!;
    const we = ws + 7 * DAY_MS;
    if (windowEndMs > ws && windowStartMs < we) out.push(i);
  }
  return out;
}

function systemCountsAsOccupiedForRolling(s: SystemBlock): boolean {
  return (
    s.system === "sleep" ||
    s.system === "routine" ||
    s.system === "travel" ||
    s.system === "weather" ||
    s.system === "inverted-timemap"
  );
}

function syntheticBusy(events: BusyEvent[]): BusyEvent[] {
  return events.filter((e) => e.busy);
}

/**
 * Minutes from synthesized `daysheet-goal:*` busy events clipped to the rolling preview window,
 * merged per goal to match overlapping slot handling in the allocator.
 */
export function daySheetLoggedMinutesByGoalInWindow(
  daySheetGoalBusy: readonly BusyEvent[],
  windowStartMs: number,
  windowEndMs: number
): Record<string, number> {
  const byGoal = new Map<string, Array<{ startMs: number; endMs: number }>>();
  for (const ev of daySheetGoalBusy) {
    const sid = ev.sourceId;
    if (!sid) continue;
    const m = sid.match(DAYSHEET_GOAL_SOURCE_RE);
    if (!m) continue;
    const goalId = m[1]!;
    const c = clip({ startMs: ev.startMs, endMs: ev.endMs }, windowStartMs, windowEndMs);
    if (!c) continue;
    const list = byGoal.get(goalId);
    if (list) list.push(c);
    else byGoal.set(goalId, [c]);
  }
  const out: Record<string, number> = {};
  for (const [gid, intervals] of byGoal) {
    const merged = mergeIntervals(intervals);
    let mins = 0;
    for (const iv of merged) {
      mins += Math.floor((iv.endMs - iv.startMs) / 60_000);
    }
    if (mins > 0) out[gid] = mins;
  }
  return out;
}

export function approximateRollingSevenDayOccupancy(input: {
  windowStartMs: number;
  windowEndMs: number;
  busy: readonly BusyEvent[];
  daySheetGoalBusy: readonly BusyEvent[];
  system: readonly SystemBlock[];
  proposed: readonly AllocatedBlock[];
  /** When false: calendar + day-sheet + system only (“capacity before placement”) */
  includeProposedBlocks: boolean;
}): { occupiedApproxMinutes: number; grossWindowMinutes: number; proposedMinutesByGoalId: Record<string, number> } {
  const { windowStartMs, windowEndMs } = input;
  const grossWindowMinutes = Math.round((windowEndMs - windowStartMs) / 60_000);
  const events: BusyEvent[] = [];

  for (const b of syntheticBusy([...input.busy])) events.push({ ...b });
  for (const b of syntheticBusy([...input.daySheetGoalBusy])) events.push({ ...b });
  for (const s of input.system) {
    if (!s.busy || !systemCountsAsOccupiedForRolling(s)) continue;
    events.push({ ...s });
  }

  for (const blk of input.proposed) {
    if (blk.segment || !input.includeProposedBlocks) continue;
    events.push({
      sourceId: `rolling-proposed-${blk.goalId}-${blk.startMs}-${blk.endMs}`,
      title: blk.title,
      startMs: blk.startMs,
      endMs: blk.endMs,
      busy: true,
      source: "internal"
    });
  }

  const rawIntervals = collectBusyIntervals(events, windowStartMs, windowEndMs);
  const merged = mergeIntervals(rawIntervals);

  let occupiedApproxMinutes = merged.reduce((acc, iv) => {
    const clipped = clip(iv, windowStartMs, windowEndMs);
    if (!clipped) return acc;
    return acc + Math.floor((clipped.endMs - clipped.startMs) / 60_000);
  }, 0);

  if (occupiedApproxMinutes > grossWindowMinutes + 60) occupiedApproxMinutes = grossWindowMinutes;

  const proposedMinutesByGoalId: Record<string, number> = {};
  for (const blk of input.proposed) {
    if (blk.segment) continue;
    const c = clip(
      { startMs: blk.startMs, endMs: blk.endMs },
      windowStartMs,
      windowEndMs
    );
    if (!c) continue;
    const m = Math.floor((c.endMs - c.startMs) / 60_000);
    if (m <= 0) continue;
    proposedMinutesByGoalId[blk.goalId] =
      (proposedMinutesByGoalId[blk.goalId] ?? 0) + m;
  }

  return { occupiedApproxMinutes, grossWindowMinutes, proposedMinutesByGoalId };
}

/** Subtract merged occupied intervals from gross window → open minutes (checks gross − union) */
export function freeMinutesFromMergedOccupancy(
  windowStartMs: number,
  windowEndMs: number,
  occupiedMerged: readonly { startMs: number; endMs: number }[]
): number {
  const merged = mergeIntervals([...occupiedMerged]);
  let covered = merged.reduce((acc, iv) => {
    const c = clip(iv, windowStartMs, windowEndMs);
    if (!c) return acc;
    return acc + Math.floor((c.endMs - c.startMs) / 60_000);
  }, 0);
  const gross = Math.floor((windowEndMs - windowStartMs) / 60_000);
  covered = Math.min(covered, gross);
  return Math.max(0, gross - covered);
}
