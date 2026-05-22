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
 *      through 12:00 the wake day) and pick the **latest** free gap that fits
 *      `durationHours` (differs from Sleep.gs, which anchored at gap start).
 *
 *   3. **Split fallback.** If no single gap fits the desired duration we
 *      pick the two largest gaps that each meet `minBlockHours` and split
 *      the night across them. If even that fails we fall back to the largest
 *      remaining gap and flag it as `underMinimum` so the caller can warn.
 *
 * When timemap **shutdown** / **morning** routines are enabled, the caller
 * passes `reserveBeforeSleepMs` / `reserveAfterSleepMs` so the placer treats
 * `[sleepStart − shutdown, sleepEnd + morning]` as busy-free against merged
 * calendar busy (routines sit between commitments and sleep / after wake).
 * Inbound drive home still extends by `bufferAfterDriveHomeMinutes` when
 * shutdown is off; when shutdown is on, that wind-down is the same strip as
 * `reserveBeforeSleepMs` so the drive leg is not double-extended.
 *
 * **Product rule (see ALLOCATOR_BUSINESS_RULES.md):** among scheduler-owned
 * busy, only travel/drive intervals (`isTravelLikeConflictTitle`) may displace
 * modelled sleep; callers should not pass other proposed blocks as collisions
 * that would move sleep off the ideal target.
 */

import type { SleepSettings } from "@calendar-automations/schema";
import type { BusyEvent, Interval } from "./types";
import { sleepConflictBusyLabel } from "./busy-label";
import { collectBusyIntervals, freeGaps } from "./intervals";

const MS_PER_HOUR = 60 * 60 * 1000;

/** Mirrors `_sleepIsTravelConflict` in Sleep.gs — planner overlap rules for drive legs. */
export function isTravelLikeConflictTitle(title: string): boolean {
  const t = (title || "").trim();
  return (
    t.startsWith("[Drive]") ||
    t.includes("->") ||
    t.includes("→") ||
    t.includes("←")
  );
}

/**
 * Busy events overlapping the ideal target window, for titling when sleep is
 * placed elsewhere (port of conflictTitles / lastMainConflict in Sleep.gs).
 * `targetOverlapTraceTitle` includes travel legs so "moved" sleep is still
 * attributable when the only collisions are `[Drive]` blocks.
 */
function targetOverlapMeta(
  busy: readonly BusyEvent[],
  targetStartMs: number,
  targetEndMs: number
): {
  hadOverlap: boolean;
  targetOverlapTitle: string | null;
  targetOverlapTraceTitle: string | null;
} {
  let hadOverlap = false;
  let bestNonTravel: { endMs: number; title: string } | null = null;
  let bestAny: { endMs: number; title: string } | null = null;
  for (const ev of busy) {
    if (!ev.busy) continue;
    if (!(ev.startMs < targetEndMs && ev.endMs > targetStartMs)) continue;
    hadOverlap = true;
    const raw = (ev.title || "").trim();
    const label = sleepConflictBusyLabel(ev);
    if (!bestAny || ev.endMs > bestAny.endMs) bestAny = { endMs: ev.endMs, title: label };
    if (isTravelLikeConflictTitle(raw)) continue;
    if (!bestNonTravel || ev.endMs > bestNonTravel.endMs) bestNonTravel = { endMs: ev.endMs, title: label };
  }
  return {
    hadOverlap,
    targetOverlapTitle: bestNonTravel?.title ?? null,
    targetOverlapTraceTitle: bestAny?.title ?? null
  };
}

export type SleepPlacement =
  | "override"
  | "target"
  | "gap"
  | "split"
  | "largest-gap";

export interface PlacedSleep extends Interval {
  /** true when this is the secondary half of a split sleep window. */
  split: boolean;
  underMinimum: boolean;
  /** How this interval was chosen (for UI / parity with legacy calendar titles). */
  placement: SleepPlacement;
  /** True when some busy interval overlapped the ideal target window. */
  targetHadOverlap: boolean;
  /** Last non-travel overlapping busy title by end time, if any. */
  targetOverlapTitle: string | null;
  /**
   * Last overlapping busy label by end time including travel/drive legs — used
   * when `targetOverlapTitle` is null so moved sleep still names a culprit.
   */
  targetOverlapTraceTitle: string | null;
}

function truncateTitle(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 3))}...`;
}

/**
 * Human-readable sleep title, including reasons when sleep moved or shrank
 * (parity with Sleep.gs extended titles).
 */
export function formatSleepBlockTitle(p: PlacedSleep, idealDurationHours: number): string {
  const base = p.split ? "Sleep (split)" : "Sleep";
  if (p.placement === "override") return base;

  const hrs = (p.endMs - p.startMs) / MS_PER_HOUR;
  const roundedHrs = Math.round(hrs * 10) / 10;
  const parts: string[] = [];
  if (p.underMinimum || roundedHrs + 1e-6 < idealDurationHours) {
    parts.push(`less than ideal sleep ${roundedHrs}h`);
  }
  if (p.placement !== "target") {
    const conflictLabel = p.targetOverlapTitle ?? p.targetOverlapTraceTitle;
    if (conflictLabel) {
      parts.push(`conflicts: ${truncateTitle(conflictLabel, 96)}`);
    } else if (p.targetHadOverlap) {
      parts.push("moved; overlap (unlabelled)");
    }
  }
  if (parts.length === 0) return base;
  return `${base} (${parts.join(", ")})`;
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
  /**
   * Timemap shutdown routine: require merged busy not to overlap
   * `[sleepStart − reserveBeforeSleepMs, sleepEnd + reserveAfterSleepMs]`.
   * Busy collection is clipped to `[windowStartMs − before, windowEndMs + after]`
   * so evening events before the nominal sleep window can still block the
   * shutdown strip.
   */
  reserveBeforeSleepMs?: number;
  /** Timemap morning routine: free time required after `sleepEnd` before busy. */
  reserveAfterSleepMs?: number;
}

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
          underMinimum: endMs - startMs < desiredMs,
          placement: "override" as const,
          targetHadOverlap: false,
          targetOverlapTitle: null,
          targetOverlapTraceTitle: null
        }
      ];
    }
  }

  const preMs = Math.max(0, options.reserveBeforeSleepMs ?? 0);
  const postMs = Math.max(0, options.reserveAfterSleepMs ?? 0);
  const clipStart = windowStartMs - preMs;
  const clipEnd = windowEndMs + postMs;
  const merged = collectBusyIntervals(busy, clipStart, clipEnd);
  const desiredMs = sleep.durationHours * MS_PER_HOUR;
  const minMs = sleep.minBlockHours * MS_PER_HOUR;

  // 1. Target window: ideal wake time, walking back the desired duration.
  //    The target lives inside the search window, so clamping is enough to
  //    keep us from scheduling sleep before the user's "earliest bedtime".
  const requestedEnd = options.targetEndMs ?? windowEndMs;
  const targetEnd = Math.min(Math.max(requestedEnd, windowStartMs), windowEndMs);
  const targetStart = Math.max(windowStartMs, targetEnd - desiredMs);
  const {
    hadOverlap: targetHadOverlap,
    targetOverlapTitle,
    targetOverlapTraceTitle
  } = targetOverlapMeta(busy, targetStart, targetEnd);

  if (
    targetEnd - targetStart >= minMs &&
    !overlapsPaddedSleep(targetStart, targetEnd, preMs, postMs, merged)
  ) {
    return [
      {
        startMs: targetStart,
        endMs: targetEnd,
        split: false,
        underMinimum: targetEnd - targetStart < desiredMs,
        placement: "target",
        targetHadOverlap,
        targetOverlapTitle,
        targetOverlapTraceTitle
      }
    ];
  }

  // 2. Search window: prefer the latest gap that fits — that keeps sleep
  //    near the target wake when the conflict was earlier in the night.
  const gaps = freeGaps(clipStart, clipEnd, merged);
  if (gaps.length === 0) return [];

  for (let i = gaps.length - 1; i >= 0; i--) {
    const gap = gaps[i]!;
    const placed = placeSleepInGap(
      gap,
      desiredMs,
      preMs,
      postMs,
      windowStartMs,
      windowEndMs
    );
    if (placed) {
      return [
        {
          startMs: placed.startMs,
          endMs: placed.endMs,
          split: false,
          underMinimum: false,
          placement: "gap",
          targetHadOverlap,
          targetOverlapTitle,
          targetOverlapTraceTitle
        }
      ];
    }
  }

  // 3. Split fallback: two largest gaps meeting minBlockHours.
  //    Reserves are not applied here (split halves do not each carry full
  //    routine wrapping in the UI); keeps behaviour stable for rare splits.
  const eligible = gaps.filter((g) => g.endMs - g.startMs >= minMs);
  if (eligible.length >= 2) {
    eligible.sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs));
    const picks = eligible.slice(0, 2).sort((a, b) => a.startMs - b.startMs);
    const total = picks.reduce((sum, p) => sum + (p.endMs - p.startMs), 0);
    return picks.map((p) => ({
      startMs: p.startMs,
      endMs: Math.min(p.endMs, p.startMs + desiredMs),
      split: true,
      underMinimum: total < desiredMs,
      placement: "split" as const,
      targetHadOverlap,
      targetOverlapTitle,
      targetOverlapTraceTitle
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
      underMinimum: true,
      placement: "largest-gap",
      targetHadOverlap,
      targetOverlapTitle,
      targetOverlapTraceTitle
    }
  ];
}

function overlapsAny(startMs: number, endMs: number, busy: readonly Interval[]): boolean {
  for (const b of busy) {
    if (b.startMs < endMs && b.endMs > startMs) return true;
  }
  return false;
}

function overlapsPaddedSleep(
  sleepStartMs: number,
  sleepEndMs: number,
  preMs: number,
  postMs: number,
  busy: readonly Interval[]
): boolean {
  return overlapsAny(sleepStartMs - preMs, sleepEndMs + postMs, busy);
}

/**
 * Right-aligns sleep in a free gap while reserving `preMs` before sleep and
 * `postMs` after (shutdown / morning). Returns null if the gap cannot fit.
 */
function placeSleepInGap(
  gap: Interval,
  desiredMs: number,
  preMs: number,
  postMs: number,
  windowStartMs: number,
  windowEndMs: number
): { startMs: number; endMs: number } | null {
  const need = preMs + desiredMs + postMs;
  if (gap.endMs - gap.startMs < need) return null;

  let endMs = Math.min(gap.endMs - postMs, windowEndMs);
  let startMs = endMs - desiredMs;

  if (startMs < Math.max(gap.startMs + preMs, windowStartMs)) {
    startMs = Math.max(gap.startMs + preMs, windowStartMs);
    endMs = startMs + desiredMs;
    if (endMs > Math.min(gap.endMs - postMs, windowEndMs)) return null;
  }

  if (startMs - preMs < gap.startMs || endMs + postMs > gap.endMs) return null;
  return { startMs, endMs };
}
