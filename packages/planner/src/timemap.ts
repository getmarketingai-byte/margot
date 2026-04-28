/**
 * Timemap band placement — TS port of the core algorithm in
 * `addEvents_TimeMapBlocks` (TimeMapBlocks.gs:996).
 *
 * Given a list of free gaps for a day, place N configurable "deep-work bands"
 * (e.g. Needle-Mover / Execute / Ops / Play) so that each band covers at least
 * its `minHours` and up to `targetHours` of discretionary time.
 *
 * Two layouts:
 *   - **Sequential** (default): bands occupy non-overlapping spans, anchored at
 *     the latest available time, in reverse band order so band 1 lands earliest.
 *   - **Cumulative deep work**: bands 1..N-1 form a single deep-work span;
 *     higher-numbered bands progressively shrink toward the end of that span,
 *     so band 1 always envelopes band 2 envelopes band 3 (overlapping events).
 *     Band N (the last band, e.g. "Play") keeps an exclusive tail.
 */

import type { TimemapBand } from "@calendar-automations/schema";
import type { Interval } from "./types";
import { mergeIntervals } from "./intervals";

export interface PlacedBlock {
  bandId: string;
  title: string;
  startMs: number;
  endMs: number;
  /** True when the band could not reach its minHours total. */
  underMinimum: boolean;
}

interface PlacementOptions {
  bands: readonly TimemapBand[];
  freeGaps: readonly Interval[];
  /** Round all block boundaries to this many minutes. 0 disables rounding. */
  minBlockMinutes: number;
  cumulativeDeepWork: boolean;
}

const MS_PER_MIN = 60_000;

/**
 * Place bands across the day's free gaps. The result is a flat list of blocks
 * tagged with their owning band id; multiple blocks per band are emitted when
 * gaps split a band's allocation.
 */
export function placeTimemapBands(opts: PlacementOptions): PlacedBlock[] {
  const sortedGaps = mergeIntervals(opts.freeGaps);
  if (sortedGaps.length === 0 || opts.bands.length === 0) return [];

  if (opts.cumulativeDeepWork) {
    return placeCumulative(opts.bands, sortedGaps, opts.minBlockMinutes);
  }
  return placeSequential(opts.bands, sortedGaps, opts.minBlockMinutes);
}

/**
 * Sequential layout: each band consumes a contiguous (possibly multi-gap)
 * suffix of the day. Allocate from the *last* band backwards from the end of
 * the day, then earlier bands fill what remains, anchoring at the latest
 * available time so morning gaps are spared for routines / non-band activity.
 */
function placeSequential(
  bands: readonly TimemapBand[],
  gaps: readonly Interval[],
  minBlockMinutes: number
): PlacedBlock[] {
  const blocks: PlacedBlock[] = [];
  // Working copy of gaps, which we will whittle from the end.
  let working = gaps.map((g) => ({ ...g }));
  // Iterate in reverse band order.
  for (let i = bands.length - 1; i >= 0; i--) {
    const band = bands[i]!;
    const targetMs = Math.round(band.targetHours * 60) * MS_PER_MIN;
    const consumed = takeFromEnd(working, targetMs, minBlockMinutes);
    const totalMs = consumed.reduce((a, b) => a + (b.endMs - b.startMs), 0);
    const minMs = Math.round(band.minHours * 60) * MS_PER_MIN;
    const underMinimum = totalMs < minMs;
    for (const c of consumed) {
      blocks.push({
        bandId: band.id,
        title: band.title,
        startMs: c.startMs,
        endMs: c.endMs,
        underMinimum
      });
    }
  }
  blocks.sort((a, b) => a.startMs - b.startMs);
  return blocks;
}

/**
 * Cumulative deep-work layout: bands 1..N-1 share a deep-work span, layered
 * such that band k covers the last (N-k)/(N-1) fraction of the span. Band N
 * (the "play" tail) takes an exclusive trailing slice.
 *
 * The algorithm:
 *   1. Reserve the tail band's targetHours (anchored at the end of the day).
 *   2. The remainder forms the deep-work span. Place band 1 across all of it,
 *      band 2 across the last 2/3, band 3 across the last 1/3 (generalised).
 *   3. Each band is split by free-gap boundaries; under-minimum is flagged.
 */
function placeCumulative(
  bands: readonly TimemapBand[],
  gaps: readonly Interval[],
  minBlockMinutes: number
): PlacedBlock[] {
  if (bands.length < 2) return placeSequential(bands, gaps, minBlockMinutes);
  const tail = bands[bands.length - 1]!;
  const deepBands = bands.slice(0, -1);

  const tailTargetMs = Math.round(tail.targetHours * 60) * MS_PER_MIN;
  let working = gaps.map((g) => ({ ...g }));
  const tailConsumed = takeFromEnd(working, tailTargetMs, minBlockMinutes);
  const tailUnder =
    tailConsumed.reduce((a, b) => a + (b.endMs - b.startMs), 0) <
    Math.round(tail.minHours * 60) * MS_PER_MIN;

  const deepGaps = working;
  const deepTotalMs = deepGaps.reduce((a, b) => a + (b.endMs - b.startMs), 0);
  const blocks: PlacedBlock[] = [];

  for (let i = 0; i < deepBands.length; i++) {
    const band = deepBands[i]!;
    const fraction = (deepBands.length - i) / deepBands.length;
    const desiredMs = Math.min(
      Math.round(band.targetHours * 60) * MS_PER_MIN,
      Math.floor(deepTotalMs * fraction)
    );
    const slice = sliceFromEndOf(deepGaps, desiredMs, minBlockMinutes);
    const totalMs = slice.reduce((a, b) => a + (b.endMs - b.startMs), 0);
    const minMs = Math.round(band.minHours * 60) * MS_PER_MIN;
    const underMinimum = totalMs < minMs;
    for (const s of slice) {
      blocks.push({
        bandId: band.id,
        title: band.title,
        startMs: s.startMs,
        endMs: s.endMs,
        underMinimum
      });
    }
  }
  for (const c of tailConsumed) {
    blocks.push({
      bandId: tail.id,
      title: tail.title,
      startMs: c.startMs,
      endMs: c.endMs,
      underMinimum: tailUnder
    });
  }
  blocks.sort((a, b) => a.startMs - b.startMs);
  return blocks;
}

/**
 * Pulls intervals totalling (up to) `targetMs` from the END of `gaps`,
 * mutating `gaps` to remove the consumed portions. Splits across gap boundaries.
 */
function takeFromEnd(
  gaps: Interval[],
  targetMs: number,
  minBlockMinutes: number
): Interval[] {
  const result: Interval[] = [];
  let remaining = targetMs;
  while (remaining > 0 && gaps.length > 0) {
    const last = gaps[gaps.length - 1]!;
    const len = last.endMs - last.startMs;
    if (len <= 0) {
      gaps.pop();
      continue;
    }
    if (len <= remaining) {
      result.unshift({ startMs: last.startMs, endMs: last.endMs });
      remaining -= len;
      gaps.pop();
    } else {
      const newStart = last.endMs - remaining;
      result.unshift({ startMs: newStart, endMs: last.endMs });
      last.endMs = newStart;
      remaining = 0;
    }
  }
  if (minBlockMinutes > 0) {
    const minMs = minBlockMinutes * MS_PER_MIN;
    return result.filter((b) => b.endMs - b.startMs >= minMs);
  }
  return result;
}

/** Returns intervals at the END of `gaps` totalling up to `targetMs`, without mutation. */
function sliceFromEndOf(
  gaps: readonly Interval[],
  targetMs: number,
  minBlockMinutes: number
): Interval[] {
  const result: Interval[] = [];
  let remaining = targetMs;
  for (let i = gaps.length - 1; i >= 0 && remaining > 0; i--) {
    const g = gaps[i]!;
    const len = g.endMs - g.startMs;
    if (len <= 0) continue;
    if (len <= remaining) {
      result.unshift({ startMs: g.startMs, endMs: g.endMs });
      remaining -= len;
    } else {
      result.unshift({ startMs: g.endMs - remaining, endMs: g.endMs });
      remaining = 0;
    }
  }
  if (minBlockMinutes > 0) {
    const minMs = minBlockMinutes * MS_PER_MIN;
    return result.filter((b) => b.endMs - b.startMs >= minMs);
  }
  return result;
}
