/**
 * Server-rendered week grid that overlays two layers:
 *   1. The user's connected Google busy events (greyed background).
 *   2. The planner's proposed blocks for this week (accent foreground).
 *
 * The grid uses absolute positioning within per-day containers, so the layout
 * scales cleanly to the time range chosen (defaults 6am–10pm in the user's
 * timezone). Events outside the visible window are rendered as small "earlier"
 * / "later" badges at the day's edges so nothing silently disappears.
 */

import type { AllocatedBlock, BusyEvent } from "@calendar-automations/planner";
import type { SystemBlock } from "@/lib/week-blocks";
import { goalColorFromKey } from "@/lib/goal-colors";
import { dispatchGoalFocus } from "@/lib/goal-focus";
import { DraggableProposedGoalBlock } from "./draggable-proposed-goal-block";
import { DraggableSystemBlock } from "./draggable-system-block";

interface WeekCalendarProps {
  /** Monday 00:00 of the week being rendered, expressed as epoch ms. */
  weekStartMs: number;
  /** IANA timezone the user expects the grid to reflect (e.g. "Australia/Melbourne"). */
  timezone: string;
  /** Real busy events (Google etc.) to render as the back layer. */
  busy: readonly BusyEvent[];
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
}

const PX_PER_HOUR = 30;

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Sleep, routines, calendar busy, and travel — goal drags must not land on top. */
function buildReservedIntervalsForGoalDrag(
  busy: readonly BusyEvent[],
  system: readonly SystemBlock[]
): { startMs: number; endMs: number }[] {
  const out: { startMs: number; endMs: number }[] = [];
  for (const b of busy) {
    if (b.busy === false) continue;
    out.push({ startMs: b.startMs, endMs: b.endMs });
  }
  for (const s of system) {
    if (s.system === "sleep" || s.system === "routine" || s.system === "travel") {
      out.push({ startMs: s.startMs, endMs: s.endMs });
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
  timezone: string,
  startHour: number,
  endHour: number,
  title: string
): PositionedBlock[] {
  const startParts = partsInTimezone(startMs, timezone);
  const weekParts = partsInTimezone(weekStartMs, timezone);
  const startDayIndex = daysBetween(weekParts, startParts);
  const startMinuteOfDay = startParts.hour * 60 + startParts.minute;
  const durationMin = Math.max(15, Math.floor((endMs - startMs) / 60_000));
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

type GoalCalendarSlice = {
  dragKey: string;
  startMs: number;
  endMs: number;
  dragOverrideSaved?: boolean;
  overrideSource?: "drag" | "actual";
  pinnedFromOverride?: boolean;
};

type ProposedPositioned = PositionedBlock & {
  isSegment: boolean;
  color: string;
  goalId?: string;
  /** Present when the allocator attached drag keys (merged bars concatenate slices). */
  goalSlices?: GoalCalendarSlice[];
};

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
        cur = {
          ...cur,
          heightPx: next.topPx + next.heightPx - cur.topPx,
          clippedBottom: next.clippedBottom,
          isSegment: cur.isSegment || next.isSegment,
          goalSlices: mergedSlices
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
  proposed,
  system = [],
  startHour = 5,
  endHour = 24,
  compact = false,
  dayIndices,
  title = "This week"
}: WeekCalendarProps) {
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

  // Build positioned arrays once, dropping events outside the window.
  const busyPositions: PositionedBlock[] = [];
  for (const b of busy) {
    busyPositions.push(
      ...position(b.startMs, b.endMs, weekStartMs, timezone, startHour, endHour, b.title)
    );
  }

  const systemPositions: Array<
    PositionedBlock & {
      kind: SystemBlock["system"];
      override?: SystemBlock["override"];
      sourceStartMs: number;
      sourceEndMs: number;
    }
  > = [];
  for (const b of system) {
    const slices = position(b.startMs, b.endMs, weekStartMs, timezone, startHour, endHour, b.title);
    for (const s of slices) {
      systemPositions.push({
        ...s,
        kind: b.system,
        override: b.override,
        sourceStartMs: b.startMs,
        sourceEndMs: b.endMs
      });
    }
  }

  const proposedPositionsRaw: ProposedPositioned[] = [];
  for (const b of proposed) {
    const slices = position(b.startMs, b.endMs, weekStartMs, timezone, startHour, endHour, b.title);
    const gid = b.goalId;
    const canDragSlices =
      Boolean(b.dragKey) &&
      !b.segment &&
      Boolean(gid) &&
      !String(gid).startsWith("segment:");
    for (const s of slices) {
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
                  pinnedFromOverride: b.pinnedFromOverride
                }
              ]
            : undefined
      });
    }
  }
  const proposedPositions = mergeAdjacentProposedSameGoal(proposedPositionsRaw);

  const hasSleep = systemPositions.some((p) => p.kind === "sleep");
  const hasTravel = systemPositions.some((p) => p.kind === "travel");
  const hasRoutine = systemPositions.some((p) => p.kind === "routine");
  const hasWeather = systemPositions.some((p) => p.kind === "weather");
  const reservedForGoalDrag = buildReservedIntervalsForGoalDrag(busy, system);

  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <div className="font-semibold">{title}</div>
        <Legend hasSleep={hasSleep} hasTravel={hasTravel} hasRoutine={hasRoutine} hasWeather={hasWeather} />
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
              {busyPositions
                .filter((p) => p.dayIndex === dayIdx)
                .map((p, i) => (
                  <BusyBlock key={`b${i}`} block={p} />
                ))}
              {systemPositions
                .filter((p) => p.dayIndex === dayIdx)
                .map((p, i) => (
                  <SystemBlockSlice key={`s${i}`} block={p} pxPerHour={PX_PER_HOUR} />
                ))}
              {proposedPositions
                .filter((p) => p.dayIndex === dayIdx)
                .map((p, i) => (
                  <ProposedBlock
                    key={`p${i}`}
                    block={p}
                    pxPerHour={PX_PER_HOUR}
                    reservedForGoalDrag={reservedForGoalDrag}
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
  hasWeather
}: {
  hasSleep: boolean;
  hasTravel: boolean;
  hasRoutine: boolean;
  hasWeather: boolean;
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

/**
 * Dispatch slice rendering. Sleep + routine blocks with override metadata
 * become interactive draggable elements; travel blocks (and any sleep slice
 * without override metadata, e.g. split halves) stay as static divs.
 */
function SystemBlockSlice({
  block,
  pxPerHour
}: {
  block: PositionedBlock & {
    kind: SystemBlock["system"];
    override?: SystemBlock["override"];
    sourceStartMs: number;
    sourceEndMs: number;
  };
  pxPerHour: number;
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
  reservedForGoalDrag
}: {
  block: PositionedBlock & {
    isSegment: boolean;
    color: string;
    goalId?: string;
    goalSlices?: GoalCalendarSlice[];
  };
  pxPerHour: number;
  reservedForGoalDrag: readonly { startMs: number; endMs: number }[];
}) {
  const goalId = block.goalId;
  const selectable = Boolean(goalId);
  const slices = block.goalSlices;
  const draggable =
    Boolean(selectable && goalId && slices && slices.length > 0 && !block.isSegment && !goalId.startsWith("segment:"));

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
      />
    );
  }

  return (
    <div
      title={`${block.title} (proposed)`}
      className={`absolute inset-x-0.5 overflow-hidden rounded px-1 py-0.5 text-[10px] font-medium text-white shadow-sm ${
        selectable ? "cursor-pointer" : ""
      }`}
      role={selectable ? "button" : undefined}
      tabIndex={selectable ? 0 : undefined}
      aria-label={selectable ? `${block.title}. Open matching goal.` : undefined}
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
      <span className="line-clamp-2 leading-tight">{block.title}</span>
    </div>
  );
}

function formatHour(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  if (h < 12) return `${h}a`;
  return `${h - 12}p`;
}
