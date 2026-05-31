"use client";

/**
 * Week grid: busy layer, system layer, proposed goal blocks. Client component so
 * planning surfaces can pass drag callbacks for optimistic UI.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  displayBusyEventLabel,
  type AllocatedBlock,
  type BusyEvent
} from "@margot/planner";
import type { WeeklyGoal, FrameworkRegistryEntry } from "@margot/schema";
import {
  effectiveWeeklyGoalWindowPlacement,
  hybridHasMixedLinearTimemapBlocking,
  hybridLinearPlacementBlocksTimemaps,
  type AllocatorGoalWindowMode
} from "@margot/schema";
import type { FrameworkOverlayLayerState } from "@/lib/framework-calendar-overlay-tags";
import { overlayTagsForGoal } from "@/lib/framework-calendar-overlay-tags";
import { systemBlockShownOnCalendarAndIcs, type SystemBlock } from "@/lib/week-blocks";
import { goalColorFromKey } from "@/lib/goal-colors";
import { dispatchGoalFocus } from "@/lib/goal-focus";
import { compareRibbonLaneKeysPriority, ribbonLaneKey } from "@/lib/ribbon-lane-order";
import { localMidnightMs } from "@/lib/week";
import {
  DraggableProposedGoalBlock,
  type GoalCalendarSlice,
  type GoalDragReservation
} from "./draggable-proposed-goal-block";
import { DraggableSystemBlock } from "./draggable-system-block";

interface WeekCalendarProps {
  /** Monday 00:00 of the week being rendered, expressed as epoch ms. */
  weekStartMs: number;
  /** IANA timezone the user expects the grid to reflect (e.g. "Australia/Melbourne"). */
  timezone: string;
  /** Real busy events (Google etc.) to render as the back layer. */
  busy: readonly BusyEvent[];
  /**
   * Day-sheet goal log intervals (same shape as busy). Rendered between
   * calendar busy and system blocks so logged time reads as actual work.
   */
  daySheetGoalBusy?: readonly BusyEvent[];
  /** Planner's proposed blocks to render as the front layer. */
  proposed: readonly AllocatedBlock[];
  /**
   * Sleep + travel blocks the planner reserves around real events. Rendered
   * as a middle layer with their own visual style so users can see them but
   * not confuse them with goal blocks or genuine calendar events.
   */
  system?: readonly SystemBlock[];
  /** First hour shown on the grid (default 6). */
  startHour?: number;
  /** Last hour shown on the grid, exclusive (default 22). */
  endHour?: number;
  /**
   * Compact mode shrinks horizontal density so the grid fits inside narrow
   * side rails (Perfect Week's right-rail preview at lg+). Vertical density
   * stays the same so block heights remain readable.
   */
  compact?: boolean;
  /** Subset of day offsets from week start to render (0=Mon, 7=next Mon). */
  dayIndices?: readonly number[];
  /** Heading label for the calendar card. */
  title?: string;
  /**
   * Called after a proposed block drag is saved so the parent can apply
   * optimistic times. Server actions already persist; use debounced soft refresh
   * to reconcile metrics without blocking each drag.
   */
  onProposedDragCommit?: (updates: Record<string, { startMs: number; endMs: number }>) => void;
  /** When goal drag overrides are cleared (reset), parent can drop optimistic patches. */
  onProposedDragOverridesCleared?: (dragKeys: string[]) => void;
  /** Goals used to render framework abbreviation chips on proposed blocks. */
  weeklyGoalsForFrameworkOverlays?: readonly WeeklyGoal[];
  /**
   * When set, invert/stacked ribbon lanes and legend use this ordering (Perfect Week hub list order,
   * including gym placement). Defaults to `weeklyGoalsForFrameworkOverlays`.
   */
  ribbonLaneOrderingGoals?: readonly WeeklyGoal[];
  /** Registry rows (`frameworkSystem.frameworks`). */
  frameworkRegistryForOverlays?: readonly FrameworkRegistryEntry[];
  frameworkOverlayLayerState?: FrameworkOverlayLayerState;
  wheelAreaLabel?: (wheelAreaId: string) => string;
  /**
   * When hybrid + mixed linear timemap blocking (some Yes / some No), proposed-block z-order is per goal.
   */
  allocatorGoalWindowMode?: AllocatorGoalWindowMode;
  /**
   * Hybrid “no blocking” weeks: draw invert/stacked timemap ribbons above greedy proposed blocks so
   * ribbons visibly sit on top. When false/omitted, proposed blocks paint above ribbons.
   */
  stackedTimemapRibbonsAboveProposedGoals?: boolean;
}

const PX_PER_HOUR = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Thin vertical timemap ribbons (invert-calendar + stacked feasible). */
const TIME_MAP_RIBBON_WIDTH_PX = 5;
/** Horizontal gap between adjacent ribbon lanes in the same day column. */
const TIME_MAP_RIBBON_GAP_PX = 2;
/** One lane column width; hover target must match this so adjacent goals do not steal pointer events. */
const TIME_MAP_RIBBON_LANE_PITCH_PX = TIME_MAP_RIBBON_WIDTH_PX + TIME_MAP_RIBBON_GAP_PX;
/** Past the weather “outside” pill (`left-1.5` ≈ 6px + ribbon width + 2px gap). */
const TIME_MAP_RIBBON_BASE_LEFT_PX = 6 + TIME_MAP_RIBBON_WIDTH_PX + 2;

/** Reverse grid geometry from `position()` for timemap ribbon tooltips. */
function timemapRibbonSliceEpochMs(
  weekStartMs: number,
  dayIndex: number,
  topPx: number,
  heightPx: number,
  startHour: number,
  timezone: string
): { sliceStartMs: number; sliceEndMs: number } {
  const approxDayMs = weekStartMs + dayIndex * DAY_MS;
  const dp = partsInTimezone(approxDayMs, timezone);
  const midnightMs = localMidnightMs(dp.year, dp.month, dp.day, timezone);
  const startMinOfDay = startHour * 60 + (topPx / PX_PER_HOUR) * 60;
  const endMinOfDay = startMinOfDay + (heightPx / PX_PER_HOUR) * 60;
  return {
    sliceStartMs: midnightMs + Math.round(startMinOfDay) * 60_000,
    sliceEndMs: midnightMs + Math.round(endMinOfDay) * 60_000
  };
}

function timemapRibbonFormatRange(
  sliceStartMs: number,
  sliceEndMs: number,
  timezone: string,
  middle: " – " | " to "
): string {
  const fmt = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  return `${fmt.format(new Date(sliceStartMs))}${middle}${fmt.format(new Date(sliceEndMs))}`;
}

function timemapRibbonAriaLabel(params: {
  goalTitle: string;
  sliceStartMs: number;
  sliceEndMs: number;
  timezone: string;
  kind: "inverted-timemap" | "stacked-timemap";
}): string {
  const { goalTitle, sliceStartMs, sliceEndMs, timezone, kind } = params;
  const range = timemapRibbonFormatRange(sliceStartMs, sliceEndMs, timezone, " to ");
  return kind === "stacked-timemap"
    ? `${goalTitle}. Stacked feasible window ${range}.`
    : `${goalTitle}. Calendar availability ${range}.`;
}

/** Above modal/dialog layers (e.g. draggable menus use ~100); portal escapes grid paint order. */
const TIME_MAP_TOOLTIP_PORTAL_Z = 50_000;

/** Match ribbon hue at the cursor; crosshair fallback keeps alignment readable on any background. */
function timemapRibbonCursorCss(barColor: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="22" viewBox="0 0 18 22"><rect x="6" y="1" width="6" height="20" rx="2" fill="${barColor}"/><rect x="7.25" y="2.25" width="3.5" height="17.5" rx="1" fill="rgba(255,255,255,0.28)"/></svg>`;
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}") 9 11, crosshair`;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function timemapRibbonTooltipAnchorPosition(
  r: DOMRectReadOnly,
  anchorFractionY: number,
  viewportW: number
): { left: number; top: number } {
  const fy = clamp01(anchorFractionY);
  const top = r.top + fy * r.height;
  const pad = 10;
  const estW = Math.min(19 * 16, viewportW - 2 * pad);
  let left = r.right + 8;
  if (left + estW > viewportW - pad) {
    left = r.left - estW - 8;
  }
  left = Math.max(pad, Math.min(left, viewportW - pad - estW));
  return { left, top };
}

function TimemapRibbonTooltipPortal({
  anchorRef,
  open,
  anchorFractionY,
  goalTitle,
  rangeLine,
  barColor
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  /** 0 = top of hit target, 1 = bottom; tracks pointer for vertical tooltip alignment. */
  anchorFractionY: number;
  goalTitle: string;
  rangeLine: string;
  barColor: string;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const fyRef = useRef(anchorFractionY);
  fyRef.current = anchorFractionY;

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const sync = () => {
      const el = anchorRef.current;
      if (!el || typeof window === "undefined") return;
      const r = el.getBoundingClientRect();
      setPos(timemapRibbonTooltipAnchorPosition(r, fyRef.current, window.innerWidth));
    };
    sync();
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [open, anchorRef]);

  useLayoutEffect(() => {
    if (!open || typeof window === "undefined") return;
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(timemapRibbonTooltipAnchorPosition(r, anchorFractionY, window.innerWidth));
  }, [open, anchorFractionY]);

  if (!open || pos === null || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed min-w-[11rem] max-w-[min(19rem,calc(100vw-2.5rem))] -translate-y-1/2 rounded-md bg-white px-2 py-1.5 text-left text-[11px] leading-snug ring-1 ring-ink-200/90 shadow-xl dark:bg-ink-900 dark:ring-ink-600/90"
      style={{
        left: pos.left,
        top: pos.top,
        zIndex: TIME_MAP_TOOLTIP_PORTAL_Z,
        boxShadow: `inset 4px 0 0 0 ${barColor}, 0 12px 28px rgb(0 0 0 / 0.18)`,
        color: barColor
      }}
    >
      <div className="pl-1 font-semibold leading-tight">{goalTitle}</div>
      <div className="mt-0.5 pl-1 tabular-nums leading-snug">{rangeLine}</div>
    </div>,
    document.body
  );
}

function TimemapRibbonHover({
  block,
  barColor,
  laneVisualLeftPx,
  goalTitle,
  rangeLine,
  ribbonAria,
  layerZClass
}: {
  block: Pick<PositionedBlock, "topPx" | "heightPx">;
  barColor: string;
  laneVisualLeftPx: number;
  goalTitle: string;
  rangeLine: string;
  ribbonAria: string;
  layerZClass: string;
}) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState(false);
  const [anchorFractionY, setAnchorFractionY] = useState(0.5);

  const syncFractionFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const h = rect.height || 1;
    setAnchorFractionY(clamp01((e.clientY - rect.top) / h));
  };

  return (
    <>
      <div
        ref={anchorRef}
        aria-label={ribbonAria}
        onMouseEnter={(e) => {
          setHover(true);
          syncFractionFromEvent(e);
        }}
        onMouseMove={(e) => {
          syncFractionFromEvent(e);
        }}
        onMouseLeave={() => setHover(false)}
        className={`absolute ${layerZClass}`}
        style={{
          top: block.topPx,
          height: block.heightPx,
          left: laneVisualLeftPx,
          width: TIME_MAP_RIBBON_LANE_PITCH_PX,
          cursor: timemapRibbonCursorCss(barColor)
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 h-full rounded-full border shadow-[0_0_0_1px_rgba(255,255,255,0.35)] dark:shadow-[0_0_0_1px_rgba(15,23,42,0.55)]"
          style={{
            width: TIME_MAP_RIBBON_WIDTH_PX,
            borderColor: barColor,
            backgroundColor: barColor,
            opacity: 0.88,
            backgroundImage:
              "repeating-linear-gradient(135deg, rgba(255,255,255,0.45) 0 2px, rgba(255,255,255,0.06) 2px 4px)"
          }}
        />
      </div>
      <TimemapRibbonTooltipPortal
        anchorRef={anchorRef}
        open={hover}
        anchorFractionY={anchorFractionY}
        goalTitle={goalTitle}
        rangeLine={rangeLine}
        barColor={barColor}
      />
    </>
  );
}

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Sleep, routines, calendar busy, travel, and logged day-sheet goal time — tagged for drag policy. */
function buildGoalDragReservations(
  busy: readonly BusyEvent[],
  system: readonly SystemBlock[],
  daySheetGoalBusy: readonly BusyEvent[] = []
): GoalDragReservation[] {
  const out: GoalDragReservation[] = [];
  for (const b of busy) {
    if (b.busy === false) continue;
    out.push({ startMs: b.startMs, endMs: b.endMs, calendarBusyLayer: true });
  }
  for (const b of daySheetGoalBusy) {
    if (b.busy === false) continue;
    out.push({ startMs: b.startMs, endMs: b.endMs, calendarBusyLayer: false });
  }
  for (const s of system) {
    if (s.system === "sleep" || s.system === "routine" || s.system === "travel") {
      out.push({ startMs: s.startMs, endMs: s.endMs, calendarBusyLayer: false });
    }
  }
  return out;
}

interface PositionedBlock {
  dayIndex: number; // 0=Mon ... 6=Sun, can extend beyond 6 for rolling views.
  topPx: number;
  heightPx: number;
  title: string;
  /** True when the block was clipped at the visible window boundary. */
  clippedTop: boolean;
  clippedBottom: boolean;
}

/**
 * Pull the year/month/day/hour/minute/weekday components for a given epoch ms,
 * formatted in the user's timezone. Used to figure out which day-column and
 * vertical offset an event lands on.
 */
function partsInTimezone(ms: number, timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
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
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday ?? ""
  };
}

/**
 * Map an ISO weekday short name to a Mon=0 index. Avoids relying on Date
 * arithmetic in the user's local TZ, which is notoriously fiddly.
 */
function isoWeekdayIndex(weekday: string): number {
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6
  };
  return map[weekday] ?? 0;
}

/**
 * Position a single time interval against the visible grid window. Returns
 * one positioned block per day the interval covers — sleep blocks routinely
 * cross midnight, so a single 23:00 → 07:00 interval becomes two blocks
 * (one on day N, one on day N+1).
 */
function position(
  startMs: number,
  endMs: number,
  weekStartMs: number,
  gridClipStartMs: number,
  gridClipEndMs: number,
  timezone: string,
  startHour: number,
  endHour: number,
  title: string
): PositionedBlock[] {
  // Drive-pres and sleep often begin before the first visible column (e.g.
  // Sunday night ahead of Monday) while still overlapping the grid. Without
  // clamping, startDayIndex is negative and the loop below never runs, so
  // those blocks disappear entirely.
  const spanStartMs = Math.max(startMs, gridClipStartMs);
  const spanEndMs = Math.min(endMs, gridClipEndMs);
  if (spanEndMs <= spanStartMs) return [];
  const clippedBeforeGrid = startMs < gridClipStartMs;
  const clippedAfterGrid = endMs > gridClipEndMs;

  const startParts = partsInTimezone(spanStartMs, timezone);
  const weekParts = partsInTimezone(weekStartMs, timezone);
  const startDayIndex = daysBetween(weekParts, startParts);
  const startMinuteOfDay = startParts.hour * 60 + startParts.minute;
  const durationMin = Math.max(15, Math.floor((spanEndMs - spanStartMs) / 60_000));
  const endMinuteAbs = startMinuteOfDay + durationMin;

  const windowStart = startHour * 60;
  const windowEnd = endHour * 60;
  const out: PositionedBlock[] = [];

  // Walk day by day: each iteration consumes [thisDayStart, min(endMinuteAbs, 1440))
  // expressed in minutes-from-startDay00:00.
  let cursor = startMinuteOfDay;
  let dayIndex = startDayIndex;
  while (cursor < endMinuteAbs && dayIndex >= 0) {
    const dayBoundary = dayIndex === startDayIndex ? 1440 : (dayIndex - startDayIndex + 1) * 1440;
    const nextBoundary = Math.min(endMinuteAbs, dayBoundary);
    // Convert the absolute-from-startDay minutes into minutes-of-this-day.
    const thisDayBase = (dayIndex - startDayIndex) * 1440;
    const localStart = cursor - thisDayBase;
    const localEnd = nextBoundary - thisDayBase;

    if (localEnd > windowStart && localStart < windowEnd) {
      const clippedTop = localStart < windowStart;
      const clippedBottom = localEnd > windowEnd;
      const topMin = Math.max(windowStart, localStart);
      const bottomMin = Math.min(windowEnd, localEnd);
      const topPx = ((topMin - windowStart) / 60) * PX_PER_HOUR;
      const heightPx = Math.max(8, ((bottomMin - topMin) / 60) * PX_PER_HOUR);
      out.push({ dayIndex, topPx, heightPx, title, clippedTop, clippedBottom });
    }

    cursor = nextBoundary;
    dayIndex++;
  }
  if (out.length > 0) {
    if (clippedBeforeGrid) {
      const first = out[0]!;
      out[0] = { ...first, clippedTop: first.clippedTop || clippedBeforeGrid };
    }
    if (clippedAfterGrid) {
      const last = out[out.length - 1]!;
      out[out.length - 1] = { ...last, clippedBottom: last.clippedBottom || clippedAfterGrid };
    }
  }
  return out;
}

/**
 * True when some portion of `[startMs, endMs)` falls on calendar day
 * `targetDayIdx` (relative to `weekStartMs`) and that portion lies entirely
 * before `startHour` — so `position(..., startHour, endHour)` renders nothing
 * for that day even though sleep exists (common after conflict-driven
 * placement into the small hours).
 */
function sleepSegmentFullyBeforeVisibleStart(
  startMs: number,
  endMs: number,
  weekStartMs: number,
  timezone: string,
  targetDayIdx: number,
  startHour: number
): boolean {
  const startParts = partsInTimezone(startMs, timezone);
  const weekParts = partsInTimezone(weekStartMs, timezone);
  const startDayIndex = daysBetween(weekParts, startParts);
  const startMinuteOfDay = startParts.hour * 60 + startParts.minute;
  const durationMin = Math.max(15, Math.floor((endMs - startMs) / 60_000));
  const endMinuteAbs = startMinuteOfDay + durationMin;
  const windowStart = startHour * 60;

  let cursor = startMinuteOfDay;
  let dayIndex = startDayIndex;
  while (cursor < endMinuteAbs && dayIndex >= 0) {
    const dayBoundary = dayIndex === startDayIndex ? 1440 : (dayIndex - startDayIndex + 1) * 1440;
    const nextBoundary = Math.min(endMinuteAbs, dayBoundary);
    const thisDayBase = (dayIndex - startDayIndex) * 1440;
    const localStart = cursor - thisDayBase;
    const localEnd = nextBoundary - thisDayBase;

    if (
      dayIndex === targetDayIdx &&
      localEnd > localStart &&
      localStart < windowStart &&
      localEnd <= windowStart
    ) {
      return true;
    }

    cursor = nextBoundary;
    dayIndex++;
  }
  return false;
}

function preWindowSleepTitlesForDay(
  system: readonly SystemBlock[],
  weekStartMs: number,
  timezone: string,
  targetDayIdx: number,
  startHour: number
): string[] {
  const titles: string[] = [];
  for (const b of system) {
    if (b.system !== "sleep") continue;
    if (
      sleepSegmentFullyBeforeVisibleStart(
        b.startMs,
        b.endMs,
        weekStartMs,
        timezone,
        targetDayIdx,
        startHour
      )
    ) {
      titles.push(b.title);
    }
  }
  return titles;
}

/**
 * Whole-day delta between two timezone-aware date components. Day index 0
 * corresponds to `from` itself.
 */
function daysBetween(
  from: ReturnType<typeof partsInTimezone>,
  to: ReturnType<typeof partsInTimezone>
): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

/** `sourceId` format from `daySheetGoalBusyEvents`. */
function goalIdFromDaySheetSourceId(sourceId: string): string | undefined {
  const m = /^daysheet-goal:([^:]+):/.exec(sourceId);
  return m?.[1];
}

type ProposedPositioned = PositionedBlock & {
  isSegment: boolean;
  color: string;
  goalId?: string;
  goalSlices?: GoalCalendarSlice[];
  frameworkOverlayChips?: ReadonlyArray<{ abbr: string; title: string }>;
};

function mergeOverlayChips(
  a: ReadonlyArray<{ abbr: string; title: string }> | undefined,
  b: ReadonlyArray<{ abbr: string; title: string }> | undefined
): ReadonlyArray<{ abbr: string; title: string }> | undefined {
  const merged = [...(a ?? []), ...(b ?? [])];
  if (merged.length === 0) return undefined;
  const seen = new Set<string>();
  const out: { abbr: string; title: string }[] = [];
  for (const c of merged) {
    const k = `${c.abbr}:${c.title}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/**
 * The allocator may emit several back-to-back blocks for one goal on the same
 * day. After `position()` they become vertically adjacent rectangles; merge
 * them so the week grid shows a single continuous bar (same UX as one slot).
 */
function mergeAdjacentProposedSameGoal(blocks: ProposedPositioned[]): ProposedPositioned[] {
  if (blocks.length <= 1) return blocks;
  const byDay = new Map<number, ProposedPositioned[]>();
  for (const b of blocks) {
    const list = byDay.get(b.dayIndex);
    if (list) list.push(b);
    else byDay.set(b.dayIndex, [b]);
  }
  const out: ProposedPositioned[] = [];
  /** Sub-pixel tolerance only; real time gaps stay separate. */
  const edgeEpsPx = 1;
  for (const dayBlocks of byDay.values()) {
    dayBlocks.sort((a, b) => a.topPx - b.topPx || a.heightPx - b.heightPx);
    let cur = dayBlocks[0]!;
    for (let i = 1; i < dayBlocks.length; i++) {
      const next = dayBlocks[i]!;
      const sameGoal =
        Boolean(cur.goalId) &&
        cur.goalId === next.goalId &&
        cur.color === next.color &&
        Math.abs(cur.topPx + cur.heightPx - next.topPx) <= edgeEpsPx;
      if (sameGoal) {
        const mergedSlices =
          cur.goalSlices || next.goalSlices
            ? [...(cur.goalSlices ?? []), ...(next.goalSlices ?? [])]
            : undefined;
        const mergedChips =
          mergeOverlayChips(cur.frameworkOverlayChips, next.frameworkOverlayChips) ??
          cur.frameworkOverlayChips ??
          next.frameworkOverlayChips;
        cur = {
          ...cur,
          heightPx: next.topPx + next.heightPx - cur.topPx,
          clippedBottom: next.clippedBottom,
          isSegment: cur.isSegment || next.isSegment,
          goalSlices: mergedSlices,
          frameworkOverlayChips: mergedChips
        };
      } else {
        out.push(cur);
        cur = next;
      }
    }
    out.push(cur);
  }
  return out;
}

export function WeekCalendar({
  weekStartMs,
  timezone,
  busy,
  daySheetGoalBusy = [],
  proposed,
  system = [],
  startHour = 5,
  endHour = 24,
  compact = false,
  dayIndices,
  title = "This week",
  onProposedDragCommit,
  onProposedDragOverridesCleared,
  weeklyGoalsForFrameworkOverlays,
  ribbonLaneOrderingGoals,
  frameworkRegistryForOverlays,
  frameworkOverlayLayerState,
  wheelAreaLabel,
  stackedTimemapRibbonsAboveProposedGoals = false,
  allocatorGoalWindowMode
}: WeekCalendarProps) {
  const schedulingGoalsForHybrid = weeklyGoalsForFrameworkOverlays ?? [];
  const hybridMixedLinearTimemapBlocking =
    allocatorGoalWindowMode === "hybrid" &&
    hybridHasMixedLinearTimemapBlocking(schedulingGoalsForHybrid, allocatorGoalWindowMode);

  const ribbonsAboveProposedGoals = stackedTimemapRibbonsAboveProposedGoals === true;
  let timemapRibbonLayerZ: string;
  let proposedGoalLayerZDefault: string;
  if (hybridMixedLinearTimemapBlocking) {
    timemapRibbonLayerZ = "z-[35]";
    proposedGoalLayerZDefault = "z-[34]";
  } else {
    timemapRibbonLayerZ = ribbonsAboveProposedGoals ? "z-[38]" : "z-[12]";
    proposedGoalLayerZDefault = ribbonsAboveProposedGoals ? "z-[22]" : "z-[34]";
  }

  const proposedGoalLayerZForBlock = useCallback(
    (goalId: string | undefined): string => {
      if (!hybridMixedLinearTimemapBlocking || !goalId) return proposedGoalLayerZDefault;
      const g = schedulingGoalsForHybrid.find((x) => x.id === goalId);
      if (!g) return proposedGoalLayerZDefault;
      if (effectiveWeeklyGoalWindowPlacement(g, "hybrid") !== "linear") return "z-[40]";
      return hybridLinearPlacementBlocksTimemaps(g, "hybrid") ? "z-[40]" : "z-[18]";
    },
    [hybridMixedLinearTimemapBlocking, proposedGoalLayerZDefault, schedulingGoalsForHybrid]
  );

  const totalHours = endHour - startHour;
  const gridHeight = totalHours * PX_PER_HOUR;
  const windowStart = startHour * 60;
  const windowEnd = endHour * 60;
  const minWidthClass = compact ? "min-w-[420px]" : "min-w-[640px]";
  const timeColClass = compact ? "w-8" : "w-12";
  const days = (dayIndices && dayIndices.length > 0 ? [...dayIndices] : [0, 1, 2, 3, 4, 5, 6]).filter(
    (d) => d >= 0
  );
  const dayCols = days.length || 7;
  const gridTemplateColumns = `${compact ? "2rem" : "3rem"} repeat(${dayCols}, minmax(0, 1fr))`;
  const nowParts = partsInTimezone(Date.now(), timezone);
  const weekParts = partsInTimezone(weekStartMs, timezone);
  const todayOffset = daysBetween(weekParts, nowParts);
  const nowMinuteOfDay = nowParts.hour * 60 + nowParts.minute;
  const nowMinuteClamped = Math.max(windowStart, Math.min(windowEnd, nowMinuteOfDay));
  const elapsedTodayPx = ((nowMinuteClamped - windowStart) / 60) * PX_PER_HOUR;

  const overlayChipsByGoalId = useMemo(() => {
    const m = new Map<string, ReadonlyArray<{ abbr: string; title: string }>>();
    const rows = frameworkRegistryForOverlays;
    const goals = weeklyGoalsForFrameworkOverlays;
    const layerState = frameworkOverlayLayerState ?? {};
    if (!goals?.length || !rows?.length) return m;
    for (const g of goals) {
      const chips = overlayTagsForGoal(g, rows, layerState, wheelAreaLabel);
      if (chips.length > 0) m.set(g.id, chips);
    }
    return m;
  }, [
    weeklyGoalsForFrameworkOverlays,
    frameworkRegistryForOverlays,
    frameworkOverlayLayerState,
    wheelAreaLabel
  ]);

  const {
    busyByDay,
    daySheetByDay,
    systemByDay,
    proposedByDay,
    reservedForGoalDrag,
    hasSleep,
    hasTravel,
    hasRoutine,
    hasWeather,
    hasDaySheetLog,
    invertedLegend
  } = useMemo(() => {
    function groupPositionsByDay<T extends { dayIndex: number }>(
      positions: readonly T[]
    ): Map<number, T[]> {
      const map = new Map<number, T[]>();
      for (const p of positions) {
        const bucket = map.get(p.dayIndex);
        if (bucket) bucket.push(p);
        else map.set(p.dayIndex, [p]);
      }
      return map;
    }

    const dayOffsetsForClip =
      days.length > 0 ? days : ([0, 1, 2, 3, 4, 5, 6] as const);
    const minDay = Math.min(...dayOffsetsForClip);
    const maxDay = Math.max(...dayOffsetsForClip);
    const gridClipStartMs = weekStartMs + minDay * DAY_MS;
    const gridClipEndMs = weekStartMs + (maxDay + 1) * DAY_MS;

    const busyPositions: PositionedBlock[] = [];
    for (const b of busy) {
      busyPositions.push(
        ...position(
          b.startMs,
          b.endMs,
          weekStartMs,
          gridClipStartMs,
          gridClipEndMs,
          timezone,
          startHour,
          endHour,
          displayBusyEventLabel(b)
        )
      );
    }

    const daySheetPositions: Array<PositionedBlock & { sourceId: string; goalId?: string }> = [];
    for (const b of daySheetGoalBusy) {
      const gid = goalIdFromDaySheetSourceId(b.sourceId);
      for (const slice of position(
        b.startMs,
        b.endMs,
        weekStartMs,
        gridClipStartMs,
        gridClipEndMs,
        timezone,
        startHour,
        endHour,
        displayBusyEventLabel(b)
      )) {
        daySheetPositions.push({ ...slice, sourceId: b.sourceId, goalId: gid });
      }
    }

    const ribbonOrderGoals = ribbonLaneOrderingGoals ?? weeklyGoalsForFrameworkOverlays;
    const ribbonLaneKeysSorted = [
      ...new Set(system.map(ribbonLaneKey).filter((k): k is string => k != null))
    ].sort((a, b) => compareRibbonLaneKeysPriority(a, b, ribbonOrderGoals));
    const invertedBarOffsetByLaneKey = new Map(ribbonLaneKeysSorted.map((k, i) => [k, i]));

    const systemPositions: Array<
      PositionedBlock & {
        kind: SystemBlock["system"];
        override?: SystemBlock["override"];
        sourceStartMs: number;
        sourceEndMs: number;
        invertedGoalId?: string;
        invertedBarOffsetIndex?: number;
      }
    > = [];
    for (const b of system) {
      if (!systemBlockShownOnCalendarAndIcs(b)) continue;
      const slices = position(
        b.startMs,
        b.endMs,
        weekStartMs,
        gridClipStartMs,
        gridClipEndMs,
        timezone,
        startHour,
        endHour,
        b.title
      );
      const ribbonGoalId =
        b.system === "inverted-timemap"
          ? b.invertedGoalId
          : b.system === "stacked-timemap"
            ? b.stackedGoalId
            : undefined;
      const invertedGoalId = ribbonGoalId;
      const laneKey = ribbonLaneKey(b);
      const invertedBarOffsetIndex =
        laneKey != null ? invertedBarOffsetByLaneKey.get(laneKey) : undefined;
      for (const s of slices) {
        systemPositions.push({
          ...s,
          kind: b.system,
          override: b.override,
          sourceStartMs: b.startMs,
          sourceEndMs: b.endMs,
          invertedGoalId,
          invertedBarOffsetIndex
        });
      }
    }

    const proposedPositionsRaw: ProposedPositioned[] = [];
    for (const b of proposed) {
      const slices = position(
        b.startMs,
        b.endMs,
        weekStartMs,
        gridClipStartMs,
        gridClipEndMs,
        timezone,
        startHour,
        endHour,
        b.title
      );
      const gid = b.goalId;
      const canDragSlices =
        Boolean(b.dragKey) &&
        !b.segment &&
        Boolean(gid) &&
        !String(gid).startsWith("segment:");
      for (const s of slices) {
        const chipList = gid ? overlayChipsByGoalId.get(gid) : undefined;
        proposedPositionsRaw.push({
          ...s,
          isSegment: Boolean(b.segment),
          color: goalColorFromKey(gid || b.title),
          goalId: gid,
          goalSlices:
            canDragSlices && b.dragKey
              ? [
                  {
                    dragKey: b.dragKey,
                    startMs: b.startMs,
                    endMs: b.endMs,
                    dragOverrideSaved: b.dragOverrideSaved,
                    overrideSource: b.overrideSource,
                    pinnedFromOverride: b.pinnedFromOverride,
                    overBusy: b.overBusy
                  }
                ]
              : undefined,
          frameworkOverlayChips: chipList && chipList.length > 0 ? chipList : undefined
        });
      }
    }
    const proposedPositions = mergeAdjacentProposedSameGoal(proposedPositionsRaw);

    const hasSleepInner = systemPositions.some((p) => p.kind === "sleep");
    const hasTravelInner = systemPositions.some((p) => p.kind === "travel");
    const hasRoutineInner = systemPositions.some((p) => p.kind === "routine");
    const hasWeatherInner = systemPositions.some((p) => p.kind === "weather");

    const invertedLegendInner: { goalId: string; title: string }[] = [];
    const invertedLegendSeen = new Set<string>();
    for (const s of system) {
      const gid =
        s.system === "inverted-timemap"
          ? s.invertedGoalId
          : s.system === "stacked-timemap"
            ? s.stackedGoalId
            : undefined;
      if (!gid) continue;
      if (invertedLegendSeen.has(gid)) continue;
      invertedLegendSeen.add(gid);
      invertedLegendInner.push({ goalId: gid, title: s.title });
    }
    invertedLegendInner.sort((a, b) =>
      compareRibbonLaneKeysPriority(`inv:${a.goalId}`, `inv:${b.goalId}`, ribbonOrderGoals)
    );

    return {
      busyByDay: groupPositionsByDay(busyPositions),
      daySheetByDay: groupPositionsByDay(daySheetPositions),
      systemByDay: groupPositionsByDay(systemPositions),
      proposedByDay: groupPositionsByDay(proposedPositions),
      reservedForGoalDrag: buildGoalDragReservations(busy, system, daySheetGoalBusy),
      hasSleep: hasSleepInner,
      hasTravel: hasTravelInner,
      hasRoutine: hasRoutineInner,
      hasWeather: hasWeatherInner,
      hasDaySheetLog: daySheetGoalBusy.length > 0,
      invertedLegend: invertedLegendInner
    };
  }, [
    busy,
    daySheetGoalBusy,
    days,
    proposed,
    system,
    weekStartMs,
    timezone,
    startHour,
    endHour,
    overlayChipsByGoalId,
    weeklyGoalsForFrameworkOverlays,
    ribbonLaneOrderingGoals
  ]);

  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <div className="font-semibold">{title}</div>
        <Legend
          hasSleep={hasSleep}
          hasTravel={hasTravel}
          hasRoutine={hasRoutine}
          hasWeather={hasWeather}
          hasDaySheetLog={hasDaySheetLog}
          invertedLegend={invertedLegend}
        />
      </div>
      <div className="overflow-x-auto">
        <div className={`grid ${minWidthClass} gap-1`} style={{ gridTemplateColumns }}>
          <div className={timeColClass} />
          {days.map((dayIdx) => (
            <DayHeader
              key={dayIdx}
              dayIndex={dayIdx}
              weekStartMs={weekStartMs}
              timezone={timezone}
            />
          ))}

          <HourColumn startHour={startHour} endHour={endHour} />

          {days.map((dayIdx) => {
            const earlySleepTitles = preWindowSleepTitlesForDay(
              system,
              weekStartMs,
              timezone,
              dayIdx,
              startHour
            );
            return (
            <div
              key={dayIdx}
              data-week-day-index={dayIdx}
              className="relative rounded border border-ink-200 dark:border-ink-600"
              style={{ height: gridHeight }}
            >
              <HourGridLines startHour={startHour} endHour={endHour} />
              {earlySleepTitles.length > 0 ? (
                <div
                  className="pointer-events-none absolute left-0.5 right-0.5 top-0 z-[26] flex justify-center"
                  title={earlySleepTitles.join(" · ")}
                >
                  <span className="max-w-[95%] truncate rounded-b border border-indigo-300/80 bg-indigo-100/95 px-1 py-0.5 text-[9px] font-medium leading-none text-indigo-950 shadow-sm dark:border-indigo-400/50 dark:bg-indigo-950/90 dark:text-indigo-100">
                    Sleep before {formatHour(startHour)}
                  </span>
                </div>
              ) : null}
              {dayIdx < todayOffset ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-ink-300/25 dark:bg-ink-900/45"
                />
              ) : dayIdx === todayOffset && nowMinuteOfDay > windowStart ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 bg-ink-300/25 dark:bg-ink-900/45"
                  style={{ height: Math.min(gridHeight, Math.max(0, elapsedTodayPx)) }}
                />
              ) : null}
              {(busyByDay.get(dayIdx) ?? []).map((p, i) => (
                  <BusyBlock key={`b${dayIdx}-${i}`} block={p} />
                ))}
              {(daySheetByDay.get(dayIdx) ?? []).map((p, i) => (
                  <DaySheetLoggedBlock key={`d${p.sourceId}-${dayIdx}-${i}`} block={p} goalId={p.goalId} />
                ))}
              {(systemByDay.get(dayIdx) ?? []).map((p, i) => (
                  <SystemBlockSlice
                    key={`s${dayIdx}-${i}`}
                    block={p}
                    pxPerHour={PX_PER_HOUR}
                    timezone={timezone}
                    weekStartMs={weekStartMs}
                    startHour={startHour}
                    timemapRibbonLayerZ={timemapRibbonLayerZ}
                  />
                ))}
              {(proposedByDay.get(dayIdx) ?? []).map((p, i) => (
                  <ProposedBlock
                    key={`p${dayIdx}-${i}`}
                    block={p}
                    pxPerHour={PX_PER_HOUR}
                    reservedForGoalDrag={reservedForGoalDrag}
                    onDragCommit={onProposedDragCommit}
                    onDragOverridesCleared={onProposedDragOverridesCleared}
                    proposedGoalLayerZ={proposedGoalLayerZForBlock(p.goalId)}
                  />
                ))}
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Legend({
  hasSleep,
  hasTravel,
  hasRoutine,
  hasWeather,
  hasDaySheetLog,
  invertedLegend
}: {
  hasSleep: boolean;
  hasTravel: boolean;
  hasRoutine: boolean;
  hasWeather: boolean;
  hasDaySheetLog: boolean;
  invertedLegend: readonly { goalId: string; title: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-400">
      <span className="inline-flex items-center gap-1">
        <span
          aria-hidden
          className="block h-3 w-3 rounded-sm border border-ink-300 bg-ink-200/70 dark:border-ink-600 dark:bg-ink-600/40"
        />
        Existing
      </span>
      {hasSleep && (
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="block h-3 w-3 rounded-sm bg-indigo-300/60 dark:bg-indigo-400/40" />
          Sleep
        </span>
      )}
      {hasRoutine && (
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="block h-3 w-3 rounded-sm bg-emerald-300/60 dark:bg-emerald-400/40" />
          Routine
        </span>
      )}
      {hasTravel && (
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="block h-3 w-3 rounded-sm bg-amber-300/60 dark:bg-amber-400/40" />
          Travel
        </span>
      )}
      {hasWeather && (
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="block h-3 w-3 rounded-sm bg-sky-300/60 dark:bg-sky-400/40" />
          Outside
        </span>
      )}
      {hasDaySheetLog && (
        <span className="inline-flex items-center gap-1">
          <span
            aria-hidden
            className="block h-3 w-3 rounded-sm border border-ink-300 bg-ink-100/80 dark:border-ink-500 dark:bg-ink-700/40"
            style={{
              borderLeftWidth: 3,
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(0,0,0,0.06) 0 2px, transparent 2px 5px)"
            }}
          />
          Logged
        </span>
      )}
      {invertedLegend.map((row) => (
        <span key={row.goalId} className="inline-flex max-w-[10rem] items-center gap-1" title={row.title}>
          <span
            aria-hidden
            className="block h-3 w-1.5 shrink-0 rounded-sm border border-ink-300/50 dark:border-ink-500/50"
            style={{ backgroundColor: goalColorFromKey(row.goalId) }}
          />
          <span className="truncate">{row.title}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className="block h-3 w-3 rounded-sm bg-accent" />
        Proposed
      </span>
    </div>
  );
}

function DayHeader({
  dayIndex,
  weekStartMs,
  timezone
}: {
  dayIndex: number;
  weekStartMs: number;
  timezone: string;
}) {
  const dayMs = weekStartMs + dayIndex * 24 * 60 * 60 * 1000;
  const parts = partsInTimezone(dayMs, timezone);
  return (
    <div className="text-center text-xs">
      <div className="font-semibold">{parts.weekday}</div>
      <div className="text-ink-400">{parts.day}</div>
    </div>
  );
}

function HourColumn({ startHour, endHour }: { startHour: number; endHour: number }) {
  const hours: number[] = [];
  for (let h = startHour; h < endHour; h++) hours.push(h);
  return (
    <div
      className="relative text-[10px] text-ink-400"
      style={{ height: (endHour - startHour) * PX_PER_HOUR }}
    >
      {hours.map((h) => (
        <div
          key={h}
          className="absolute right-1 -translate-y-1/2"
          style={{ top: (h - startHour) * PX_PER_HOUR }}
        >
          {formatHour(h)}
        </div>
      ))}
    </div>
  );
}

function HourGridLines({ startHour, endHour }: { startHour: number; endHour: number }) {
  const lines: number[] = [];
  for (let h = startHour + 1; h < endHour; h++) lines.push(h);
  return (
    <>
      {lines.map((h) => (
        <div
          key={h}
          aria-hidden
          className="absolute inset-x-0 border-t border-ink-100 dark:border-ink-600/30"
          style={{ top: (h - startHour) * PX_PER_HOUR }}
        />
      ))}
    </>
  );
}

function BusyBlock({ block }: { block: PositionedBlock }) {
  return (
    <div
      title={block.title}
      className="absolute inset-x-0.5 overflow-hidden rounded border border-ink-200 bg-ink-100/80 px-1 py-0.5 text-[10px] text-ink-600 backdrop-blur-sm dark:border-ink-600/40 dark:bg-ink-600/30 dark:text-ink-200"
      style={{
        top: block.topPx,
        height: block.heightPx,
        backgroundImage:
          "repeating-linear-gradient(45deg, rgba(0,0,0,0.04) 0 2px, transparent 2px 6px)"
      }}
    >
      <span className="line-clamp-2 leading-tight">{block.title}</span>
      {block.clippedTop && <span className="sr-only">starts earlier</span>}
      {block.clippedBottom && <span className="sr-only">ends later</span>}
    </div>
  );
}

function DaySheetLoggedBlock({ block, goalId }: { block: PositionedBlock; goalId?: string }) {
  const accent = goalId ? goalColorFromKey(goalId) : undefined;
  const selectable = Boolean(goalId);
  return (
    <div
      title={block.title}
      className={`absolute inset-x-0.5 z-[8] overflow-hidden rounded border border-ink-200 bg-ink-100/85 px-1 py-0.5 pl-1.5 text-[10px] text-ink-700 backdrop-blur-sm dark:border-ink-600/45 dark:bg-ink-600/35 dark:text-ink-100 ${
        selectable ? "cursor-pointer" : ""
      }`}
      style={{
        top: block.topPx,
        height: block.heightPx,
        borderLeftWidth: 4,
        borderLeftColor: accent ?? "rgba(100,116,139,0.65)",
        backgroundImage:
          "repeating-linear-gradient(45deg, rgba(0,0,0,0.05) 0 2px, transparent 2px 6px)"
      }}
      role={selectable ? "button" : undefined}
      tabIndex={selectable ? 0 : undefined}
      aria-label={selectable ? `${block.title}. Open matching goal.` : undefined}
      onClick={selectable && goalId ? () => dispatchGoalFocus(goalId) : undefined}
      onKeyDown={
        selectable && goalId
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                dispatchGoalFocus(goalId);
              }
            }
          : undefined
      }
    >
      <span className="line-clamp-2 leading-tight">{block.title}</span>
      {block.clippedTop && <span className="sr-only">starts earlier</span>}
      {block.clippedBottom && <span className="sr-only">ends later</span>}
    </div>
  );
}

/**
 * Dispatch slice rendering. Sleep + routine blocks with override metadata
 * become interactive draggable elements; travel blocks (and any sleep slice
 * without override metadata, e.g. split halves) stay as static divs.
 */
function SystemBlockSlice({
  block,
  pxPerHour,
  timezone,
  weekStartMs,
  startHour,
  timemapRibbonLayerZ
}: {
  block: PositionedBlock & {
    kind: SystemBlock["system"];
    override?: SystemBlock["override"];
    sourceStartMs: number;
    sourceEndMs: number;
    invertedGoalId?: string;
    invertedBarOffsetIndex?: number;
  };
  pxPerHour: number;
  timezone: string;
  weekStartMs: number;
  startHour: number;
  timemapRibbonLayerZ: string;
}) {
  if (block.kind === "weather") {
    return (
      <div
        title={block.title}
        aria-label="Outside window"
        className="pointer-events-none absolute left-1.5 z-30 rounded-full border border-sky-400/90 bg-sky-300/80 shadow-[0_0_0_1px_rgba(255,255,255,0.45)] dark:border-sky-300/90 dark:bg-sky-400/55 dark:shadow-[0_0_0_1px_rgba(15,23,42,0.65)]"
        style={{
          top: block.topPx,
          height: block.heightPx,
          width: 5,
          backgroundImage:
            "repeating-linear-gradient(135deg, rgba(255,255,255,0.55) 0 2px, rgba(255,255,255,0.05) 2px 4px)"
        }}
      />
    );
  }
  if (block.kind === "inverted-timemap" || block.kind === "stacked-timemap") {
    const colorKey = block.invertedGoalId ?? block.title;
    const barColor = goalColorFromKey(colorKey);
    const laneIndex = block.invertedBarOffsetIndex ?? 0;
    const laneVisualLeftPx =
      TIME_MAP_RIBBON_BASE_LEFT_PX +
      laneIndex * TIME_MAP_RIBBON_LANE_PITCH_PX;
    const goalTitle =
      block.kind === "stacked-timemap"
        ? block.title.replace(/\s*·\s*stacked window\s*$/i, "").trim()
        : block.title;
    const { sliceStartMs, sliceEndMs } = timemapRibbonSliceEpochMs(
      weekStartMs,
      block.dayIndex,
      block.topPx,
      block.heightPx,
      startHour,
      timezone
    );
    const rangeLine = timemapRibbonFormatRange(sliceStartMs, sliceEndMs, timezone, " – ");
    const ribbonAria = timemapRibbonAriaLabel({
      goalTitle,
      sliceStartMs,
      sliceEndMs,
      timezone,
      kind: block.kind
    });
    return (
      <TimemapRibbonHover
        block={block}
        barColor={barColor}
        laneVisualLeftPx={laneVisualLeftPx}
        goalTitle={goalTitle}
        rangeLine={rangeLine}
        ribbonAria={ribbonAria}
        layerZClass={timemapRibbonLayerZ}
      />
    );
  }
  // Sleep gets a calm violet; travel gets a warm amber; routines get a soft
  // emerald. All three sit between the grey "existing" layer and the solid
  // accent "proposed" layer in z-order so the user reads them as
  // platform-reserved time, not user-chosen blocks.
  const styles =
    block.kind === "sleep"
      ? "bg-indigo-200/70 text-indigo-900 dark:bg-indigo-500/30 dark:text-indigo-100"
      : block.kind === "travel"
        ? "bg-amber-200/70 text-amber-900 dark:bg-amber-500/30 dark:text-amber-100"
        : "bg-emerald-200/70 text-emerald-900 dark:bg-emerald-500/30 dark:text-emerald-100";

  if (block.override) {
    return (
      <DraggableSystemBlock
        topPx={block.topPx}
        heightPx={block.heightPx}
        pxPerHour={pxPerHour}
        title={block.title}
        styles={styles}
        startMs={block.sourceStartMs}
        endMs={block.sourceEndMs}
        overrideKind={block.override.kind}
        overrideKey={block.override.key}
        isOverridden={block.override.isOverridden}
      />
    );
  }
  return (
    <div
      title={block.title}
      className={`absolute inset-x-0.5 overflow-hidden rounded px-1 py-0.5 text-[10px] ${styles}`}
      style={{ top: block.topPx, height: block.heightPx }}
    >
      <span className="line-clamp-2 leading-tight">{block.title}</span>
    </div>
  );
}

function ProposedBlock({
  block,
  pxPerHour,
  reservedForGoalDrag,
  onDragCommit,
  onDragOverridesCleared,
  proposedGoalLayerZ
}: {
  block: PositionedBlock & {
    isSegment: boolean;
    color: string;
    goalId?: string;
    goalSlices?: GoalCalendarSlice[];
    frameworkOverlayChips?: ReadonlyArray<{ abbr: string; title: string }>;
  };
  pxPerHour: number;
  reservedForGoalDrag: readonly GoalDragReservation[];
  onDragCommit?: (updates: Record<string, { startMs: number; endMs: number }>) => void;
  onDragOverridesCleared?: (dragKeys: string[]) => void;
  proposedGoalLayerZ: string;
}) {
  const goalId = block.goalId;
  const selectable = Boolean(goalId);
  const slices = block.goalSlices;
  const isBusyOverlayVisual = slices?.some((s) => s.overBusy) ?? false;
  const draggable =
    Boolean(selectable && goalId && slices && slices.length > 0 && !block.isSegment && !goalId.startsWith("segment:"));

  const chipHint =
    block.frameworkOverlayChips && block.frameworkOverlayChips.length > 0
      ? ` · ${block.frameworkOverlayChips.map((c) => c.title).join(" · ")}`
      : "";

  if (draggable && goalId && slices) {
    return (
      <DraggableProposedGoalBlock
        topPx={block.topPx}
        heightPx={block.heightPx}
        pxPerHour={pxPerHour}
        title={block.title}
        backgroundColor={block.color}
        opacity={block.isSegment ? 0.72 : 1}
        goalId={goalId}
        slices={slices}
        dayIndex={block.dayIndex}
        reservedForGoalDrag={reservedForGoalDrag}
        onDragCommit={onDragCommit}
        onDragOverridesCleared={onDragOverridesCleared}
        frameworkOverlayChips={block.frameworkOverlayChips}
        layerZClass={proposedGoalLayerZ}
        allowCalendarBusyOverlap={slices.some((s) => s.overBusy)}
      />
    );
  }

  return (
    <div
      title={`${block.title} (proposed)${chipHint}`}
      className={`absolute inset-x-0.5 ${proposedGoalLayerZ} overflow-hidden rounded px-1 py-0.5 text-[10px] font-medium text-white shadow-sm ${
        selectable ? "cursor-pointer" : ""
      } ${isBusyOverlayVisual ? "ring-1 ring-dashed ring-white/80 ring-inset" : ""}`}
      role={selectable ? "button" : undefined}
      tabIndex={selectable ? 0 : undefined}
      aria-label={
        selectable ? `${block.title}. Open matching goal.${chipHint ? ` Tags:${chipHint}` : ""}` : undefined
      }
      onClick={
        selectable && goalId ? () => dispatchGoalFocus(goalId) : undefined
      }
      onKeyDown={
        selectable && goalId
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                dispatchGoalFocus(goalId);
              }
            }
          : undefined
      }
      style={{
        top: block.topPx,
        height: block.heightPx,
        backgroundColor: block.color,
        opacity: block.isSegment ? 0.72 : 1
      }}
    >
      <div className="flex flex-col gap-0.5">
        <span className="line-clamp-2 leading-tight">{block.title}</span>
        {block.frameworkOverlayChips && block.frameworkOverlayChips.length > 0 ? (
          <div className="pointer-events-none flex flex-wrap gap-0.5">
            {block.frameworkOverlayChips.map((c, idx) => (
              <span
                key={`${c.abbr}-${idx}`}
                title={c.title}
                className="rounded bg-black/35 px-1 text-[7px] font-semibold uppercase leading-none text-white/95 backdrop-blur-sm"
              >
                {c.abbr}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatHour(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  if (h < 12) return `${h}a`;
  return `${h - 12}p`;
}
