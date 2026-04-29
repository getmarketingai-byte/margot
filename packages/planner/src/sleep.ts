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
 * The legacy code also refuses to "sleep in" off a late drive home — that
 * concern is handled by the caller, which extends drive-home end times by
 * `bufferAfterDriveHomeMinutes` before passing them in here. By the time we
 * see the busy stream the drive-home buffer already shows up as occupied.
 */

import type { SleepSettings } from "@calendar-automations/schema";
import type { BusyEvent, Interval } from "./types";
import { collectBusyIntervals, freeGaps } from "./intervals";

const MS_PER_HOUR = 60 * 60 * 1000;

/** Mirrors `_sleepIsTravelConflict` in Sleep.gs — not shown as the primary conflict reason. */
function isTravelLikeConflictTitle(title: string): boolean {
  const t = (title || "").trim();
  return t.startsWith("[Drive]") || t.includes("->");
}

/**
 * Busy events overlapping the ideal target window, for titling when sleep is
 * placed elsewhere (port of conflictTitles / lastMainConflict in Sleep.gs).
 */
function targetOverlapMeta(
  busy: readonly BusyEvent[],
  targetStartMs: number,
  targetEndMs: number
): { hadOverlap: boolean; lastMainTitle: string | null } {
  let hadOverlap = false;
  let best: { endMs: number; title: string } | null = null;
  for (const ev of busy) {
    if (!ev.busy) continue;
    if (!(ev.startMs < targetEndMs && ev.endMs > targetStartMs)) continue;
    hadOverlap = true;
    const raw = (ev.title || "").trim();
    const t = raw.length > 0 ? raw : "(no title)";
    if (isTravelLikeConflictTitle(t)) continue;
    if (!best || ev.endMs > best.endMs) best = { endMs: ev.endMs, title: t };
  }
  return { hadOverlap, lastMainTitle: best?.title ?? null };
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
    if (p.targetOverlapTitle) {
      parts.push(`conflicts: ${truncateTitle(p.targetOverlapTitle, 72)}`);
    } else if (p.targetHadOverlap) {
      parts.push("moved; conflict had no title");
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
          targetOverlapTitle: null
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
  const { hadOverlap: targetHadOverlap, lastMainTitle: targetOverlapTitle } = targetOverlapMeta(
    busy,
    targetStart,
    targetEnd
  );

  if (targetEnd - targetStart >= minMs && !overlapsAny(targetStart, targetEnd, merged)) {
    return [
      {
        startMs: targetStart,
        endMs: targetEnd,
        split: false,
        underMinimum: targetEnd - targetStart < desiredMs,
        placement: "target",
        targetHadOverlap,
        targetOverlapTitle
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
      return [
        {
          startMs: start,
          endMs: gap.endMs,
          split: false,
          underMinimum: false,
          placement: "gap",
          targetHadOverlap,
          targetOverlapTitle
        }
      ];
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
      underMinimum: total < desiredMs,
      placement: "split" as const,
      targetHadOverlap,
      targetOverlapTitle
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
      targetOverlapTitle
    }
  ];
}

function overlapsAny(startMs: number, endMs: number, busy: readonly Interval[]): boolean {
  for (const b of busy) {
    if (b.startMs < endMs && b.endMs > startMs) return true;
  }
  return false;
}
