/**
 * Sleep block placement — port of the core ideas in Sleep.gs.
 *
 * Reserves up to `durationHours` per night ending at the configured ideal wake
 * (or earlier when a busy event forces an earlier wake). Adapts around busy
 * events that fall inside the sleep window (e.g. shift work) by either
 * shifting the block or splitting it into two halves of at least `minBlockHours`.
 */

import type { SleepSettings } from "@calendar-automations/schema";
import type { BusyEvent, Interval } from "./types";
import { collectBusyIntervals, freeGaps } from "./intervals";

export interface PlacedSleep extends Interval {
  /** true when this is the secondary half of a split sleep window. */
  split: boolean;
  underMinimum: boolean;
}

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Build sleep blocks for each night's window in the planning range.
 *
 * `windowStartMs` is the start of the first night's window (configured
 * `sleepBeginHour` on day D-1 in user TZ); the caller is responsible for
 * computing per-night windows in their timezone.
 */
export function placeSleepBlock(
  windowStartMs: number,
  windowEndMs: number,
  busy: readonly BusyEvent[],
  sleep: SleepSettings
): PlacedSleep[] {
  const merged = collectBusyIntervals(busy, windowStartMs, windowEndMs);
  const gaps = freeGaps(windowStartMs, windowEndMs, merged);
  const desiredMs = sleep.durationHours * MS_PER_HOUR;
  const minMs = sleep.minBlockHours * MS_PER_HOUR;

  // Prefer one contiguous block ending at windowEnd.
  const trailing = gaps[gaps.length - 1];
  if (trailing && trailing.endMs - trailing.startMs >= desiredMs) {
    const start = trailing.endMs - desiredMs;
    return [{ startMs: start, endMs: trailing.endMs, split: false, underMinimum: false }];
  }

  // Otherwise split across the two largest gaps that each meet minBlock.
  const eligible = gaps.filter((g) => g.endMs - g.startMs >= minMs);
  if (eligible.length === 0) {
    if (gaps.length === 0) return [];
    const fallback = gaps[gaps.length - 1]!;
    return [
      {
        startMs: fallback.startMs,
        endMs: fallback.endMs,
        split: false,
        underMinimum: true
      }
    ];
  }
  eligible.sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs));
  const picks = eligible.slice(0, 2).sort((a, b) => a.startMs - b.startMs);
  const total = picks.reduce((a, b) => a + (b.endMs - b.startMs), 0);
  const isSplit = picks.length > 1;
  return picks.map((p) => ({
    startMs: p.startMs,
    endMs: Math.min(p.endMs, p.startMs + desiredMs),
    split: isSplit,
    underMinimum: total < desiredMs
  }));
}
