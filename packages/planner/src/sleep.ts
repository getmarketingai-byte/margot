/**
 * Sleep block placement — port of the core ideas in `Sleep.gs`.
 *
 * The legacy contract has three layers, smallest to largest:
 *
 *   1. **Target window.** Sleep ends at `targetEndMs` (the user's ideal wake,
 *      possibly pulled earlier by an outbound drive) and runs back
 *      `durationHours`. If nothing busy overlaps that span we use it as-is.
 *
 *   2. **Search window.** When the target collides with a busy event we widen
 *      to `[windowStartMs, windowEndMs]` (typically 20:00 the night before
 *      through 12:00 the wake day) and look for the first gap big enough.
 *
 *   3. **Split fallback.** If no single gap fits the desired duration we
 *      pick the two largest gaps that each meet `minBlockHours` and split
 *      the night across them. If even that fails we fall back to the largest
 *      remaining gap and flag it as `underMinimum` so the caller can warn.
 *
 * The legacy code also refuses to "sleep in" off a late drive home — that
 * concern is handled by the caller, which extends drive-home end times by
 * `bufferAfterDriveHomeMinutes` before passing them in here. By the time we
 * see the busy stream the drive-home buffer already shows up as occupied.
 */

import type { SleepSettings } from "@calendar-automations/schema";
import type { BusyEvent, Interval } from "./types";
import { collectBusyIntervals, freeGaps } from "./intervals";

export interface PlacedSleep extends Interval {
  /** true when this is the secondary half of a split sleep window. */
  split: boolean;
  underMinimum: boolean;
}

export interface PlaceSleepOptions {
  /**
   * Preferred wake time in epoch ms. When provided, the placer first tries
   * to schedule `[targetEndMs - durationHours, targetEndMs]` and only widens
   * the search if that span overlaps a busy event. Defaults to `windowEndMs`
   * for backward compatibility.
   */
  targetEndMs?: number;
  /**
   * User-supplied override for this night. When present the placer returns
   * `[startMs, endMs]` verbatim, skipping the target/search/split logic.
   * The downstream routine pass uses the override result as the anchor for
   * morning/shutdown routines, so dragging sleep automatically moves them.
   */
  override?: { startMs: number; endMs: number };
}

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Build sleep blocks for a single night's window.
 *
 * `windowStartMs` is the earliest the user could plausibly sleep on this
 * night (typically `sleep.windowStartHour` the day before in user TZ);
 * `windowEndMs` is the latest acceptable wake time (typically
 * `sleep.windowEndHour` on the wake day).
 */
export function placeSleepBlock(
  windowStartMs: number,
  windowEndMs: number,
  busy: readonly BusyEvent[],
  sleep: SleepSettings,
  options: PlaceSleepOptions = {}
): PlacedSleep[] {
  // 0. Override short-circuit: a drag override wins over every other
  //    placement rule. We honour the user's hand-placed sleep verbatim,
  //    even if it falls outside the search window or overlaps busy time —
  //    they explicitly asked for it. Routines anchor on this result.
  if (options.override) {
    const { startMs, endMs } = options.override;
    if (endMs > startMs) {
      const desiredMs = sleep.durationHours * MS_PER_HOUR;
      return [
        {
          startMs,
          endMs,
          split: false,
          underMinimum: endMs - startMs < desiredMs
        }
      ];
    }
  }

  const merged = collectBusyIntervals(busy, windowStartMs, windowEndMs);
  const desiredMs = sleep.durationHours * MS_PER_HOUR;
  const minMs = sleep.minBlockHours * MS_PER_HOUR;

  // 1. Target window: ideal wake time, walking back the desired duration.
  //    The target lives inside the search window, so clamping is enough to
  //    keep us from scheduling sleep before the user's "earliest bedtime".
  const requestedEnd = options.targetEndMs ?? windowEndMs;
  const targetEnd = Math.min(Math.max(requestedEnd, windowStartMs), windowEndMs);
  const targetStart = Math.max(windowStartMs, targetEnd - desiredMs);

  if (targetEnd - targetStart >= minMs && !overlapsAny(targetStart, targetEnd, merged)) {
    return [
      {
        startMs: targetStart,
        endMs: targetEnd,
        split: false,
        underMinimum: targetEnd - targetStart < desiredMs
      }
    ];
  }

  // 2. Search window: prefer the latest gap that fits — that keeps sleep
  //    near the target wake when the conflict was earlier in the night.
  const gaps = freeGaps(windowStartMs, windowEndMs, merged);
  if (gaps.length === 0) return [];

  for (let i = gaps.length - 1; i >= 0; i--) {
    const gap = gaps[i]!;
    if (gap.endMs - gap.startMs >= desiredMs) {
      const start = Math.max(gap.startMs, gap.endMs - desiredMs);
      return [{ startMs: start, endMs: gap.endMs, split: false, underMinimum: false }];
    }
  }

  // 3. Split fallback: two largest gaps meeting minBlockHours.
  const eligible = gaps.filter((g) => g.endMs - g.startMs >= minMs);
  if (eligible.length >= 2) {
    eligible.sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs));
    const picks = eligible.slice(0, 2).sort((a, b) => a.startMs - b.startMs);
    const total = picks.reduce((sum, p) => sum + (p.endMs - p.startMs), 0);
    return picks.map((p) => ({
      startMs: p.startMs,
      endMs: Math.min(p.endMs, p.startMs + desiredMs),
      split: true,
      underMinimum: total < desiredMs
    }));
  }

  // 4. Last resort: the single largest gap, marked underMinimum.
  let largest = gaps[0]!;
  for (const g of gaps) {
    if (g.endMs - g.startMs > largest.endMs - largest.startMs) largest = g;
  }
  return [
    {
      startMs: largest.startMs,
      endMs: largest.endMs,
      split: false,
      underMinimum: true
    }
  ];
}

function overlapsAny(startMs: number, endMs: number, busy: readonly Interval[]): boolean {
  for (const b of busy) {
    if (b.startMs < endMs && b.endMs > startMs) return true;
  }
  return false;
}
