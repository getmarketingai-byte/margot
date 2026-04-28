/**
 * Pure interval algebra — port of the busy/free helpers in TimeMapBlocks.gs
 * (`_timeMapMergeIntervals`, `_timeMapFreeGaps`) without any CalendarApp coupling.
 */

import type { BusyEvent, Interval } from "./types";

/** Merge overlapping or touching intervals; returns sorted disjoint result. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const first = sorted[0]!;
  const out: Interval[] = [{ startMs: first.startMs, endMs: first.endMs }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.startMs <= last.endMs) {
      if (cur.endMs > last.endMs) last.endMs = cur.endMs;
    } else {
      out.push({ startMs: cur.startMs, endMs: cur.endMs });
    }
  }
  return out;
}

/** Returns the disjoint free gaps in [windowStart, windowEnd) given merged busy. */
export function freeGaps(
  windowStartMs: number,
  windowEndMs: number,
  mergedBusy: readonly Interval[]
): Interval[] {
  const gaps: Interval[] = [];
  let cursor = windowStartMs;
  for (const b of mergedBusy) {
    if (b.startMs > cursor) gaps.push({ startMs: cursor, endMs: b.startMs });
    if (b.endMs > cursor) cursor = b.endMs;
  }
  if (cursor < windowEndMs) gaps.push({ startMs: cursor, endMs: windowEndMs });
  return gaps;
}

/** Clip an interval to a window; returns null when fully outside. */
export function clip(
  interval: Interval,
  windowStartMs: number,
  windowEndMs: number
): Interval | null {
  const s = Math.max(interval.startMs, windowStartMs);
  const e = Math.min(interval.endMs, windowEndMs);
  return e > s ? { startMs: s, endMs: e } : null;
}

/** Sum of interval lengths in minutes. */
export function totalMinutes(intervals: readonly Interval[]): number {
  let total = 0;
  for (const it of intervals) total += Math.max(0, it.endMs - it.startMs);
  return Math.floor(total / 60_000);
}

/**
 * Filters busy events to those that count for planning. Mirrors
 * `_timeMapCollectBusyIntervals`'s rules: skip all-day, skip multi-day, treat
 * `busy: false` as free.
 */
export function collectBusyIntervals(
  events: readonly BusyEvent[],
  windowStartMs: number,
  windowEndMs: number
): Interval[] {
  const multiDayThresholdMs = 24 * 60 * 60 * 1000;
  const out: Interval[] = [];
  for (const ev of events) {
    if (!ev.busy) continue;
    const dur = ev.endMs - ev.startMs;
    if (dur >= multiDayThresholdMs) continue;
    const clipped = clip(ev, windowStartMs, windowEndMs);
    if (clipped) out.push(clipped);
  }
  out.sort((a, b) => a.startMs - b.startMs);
  return out;
}
