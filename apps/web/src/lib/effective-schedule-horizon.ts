/**
 * Paid vs trial schedule horizon for multi-week allocation (preview + ICS goals).
 */

import type { BillingState } from "@/lib/subscription";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export interface EffectiveScheduleHorizon {
  /** ISO weeks allocated starting at {@link baseWeekStartMs}. */
  isoWeekCount: number;
  /** Rolling end for trial clipping (`nowMs + 7d`); full-span end for paid (`baseWeekStartMs + isoWeekCount * week`). */
  horizonEndMs: number;
  /** When true, clip goal proposal intervals to `horizonEndMs` (trial rolling window). */
  trialRollingClip: boolean;
  /** Segment for allocator cache keys — must change when billing tier or horizon shape changes. */
  cacheKeySegment: string;
}

function paidScheduleEligible(mode: BillingState["mode"]): boolean {
  return mode === "subscription" || mode === "bypass";
}

/**
 * Computes how many ISO weeks to allocate from `baseWeekStartMs`, and the rolling clip boundary for trials.
 */
export function effectiveScheduleHorizon(input: {
  billing: BillingState;
  storedScheduleHorizonWeeks: number;
  nowMs: number;
  /** Local Monday 00:00 of the ISO week containing `nowMs`. */
  baseWeekStartMs: number;
}): EffectiveScheduleHorizon {
  const { billing, storedScheduleHorizonWeeks, nowMs, baseWeekStartMs } = input;

  if (paidScheduleEligible(billing.mode)) {
    const isoWeekCount = Math.min(8, Math.max(1, Math.floor(storedScheduleHorizonWeeks)));
    const horizonEndMs = baseWeekStartMs + isoWeekCount * WEEK_MS;
    return {
      isoWeekCount,
      horizonEndMs,
      trialRollingClip: false,
      cacheKeySegment: `paid-w${isoWeekCount}`
    };
  }

  // Trial and expired dashboard users: cap scheduled goals at 7 rolling days.
  const horizonEndMs = nowMs + 7 * DAY_MS;
  const spanMs = horizonEndMs - baseWeekStartMs;
  const isoWeekCount = Math.min(8, Math.max(1, Math.ceil(spanMs / WEEK_MS)));
  return {
    isoWeekCount,
    horizonEndMs,
    trialRollingClip: true,
    cacheKeySegment: `trial-w${isoWeekCount}`
  };
}

/** Clip interval-shaped blocks so nothing extends past `horizonEndMs`; drop blocks entirely past it. */
export function clipIntervalBlocksToHorizon<T extends { startMs: number; endMs: number }>(
  blocks: readonly T[],
  horizonEndMs: number
): T[] {
  const out: T[] = [];
  for (const b of blocks) {
    if (b.startMs >= horizonEndMs) continue;
    const endMs = Math.min(b.endMs, horizonEndMs);
    if (endMs <= b.startMs) continue;
    out.push(endMs === b.endMs ? { ...b } : { ...b, endMs });
  }
  return out;
}

export { DAY_MS, WEEK_MS };
