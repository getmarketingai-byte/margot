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
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PX_PER_HOUR = 30;

interface PositionedBlock {
  dayIndex: number; // 0=Mon ... 6=Sun
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
  while (cursor < endMinuteAbs && dayIndex >= 0 && dayIndex <= 6) {
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

export function WeekCalendar({
  weekStartMs,
  timezone,
  busy,
  proposed,
  system = [],
  startHour = 5,
  endHour = 24,
  compact = false
}: WeekCalendarProps) {
  const totalHours = endHour - startHour;
  const gridHeight = totalHours * PX_PER_HOUR;
  const minWidthClass = compact ? "min-w-[420px]" : "min-w-[640px]";
  const timeColClass = compact ? "w-8" : "w-12";
  const gridColsClass = compact
    ? "grid-cols-[2rem_repeat(7,minmax(0,1fr))]"
    : "grid-cols-[3rem_repeat(7,minmax(0,1fr))]";

  // Build positioned arrays once, dropping events outside the window.
  const busyPositions: PositionedBlock[] = [];
  for (const b of busy) {
    busyPositions.push(
      ...position(b.startMs, b.endMs, weekStartMs, timezone, startHour, endHour, b.title)
    );
  }

  const systemPositions: Array<PositionedBlock & { kind: SystemBlock["system"] }> = [];
  for (const b of system) {
    const slices = position(b.startMs, b.endMs, weekStartMs, timezone, startHour, endHour, b.title);
    for (const s of slices) systemPositions.push({ ...s, kind: b.system });
  }

  const proposedPositions: Array<PositionedBlock & { isSegment: boolean }> = [];
  for (const b of proposed) {
    const slices = position(b.startMs, b.endMs, weekStartMs, timezone, startHour, endHour, b.title);
    for (const s of slices) proposedPositions.push({ ...s, isSegment: Boolean(b.segment) });
  }

  const hasSleep = systemPositions.some((p) => p.kind === "sleep");
  const hasTravel = systemPositions.some((p) => p.kind === "travel");

  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <div className="font-semibold">This week</div>
        <Legend hasSleep={hasSleep} hasTravel={hasTravel} />
      </div>
      <div className="overflow-x-auto">
        <div className={`grid ${minWidthClass} ${gridColsClass} gap-1`}>
          <div className={timeColClass} />
          {DAY_LABELS.map((d, i) => (
            <DayHeader key={d} label={d} dayIndex={i} weekStartMs={weekStartMs} timezone={timezone} />
          ))}

          <HourColumn startHour={startHour} endHour={endHour} />

          {Array.from({ length: 7 }).map((_, dayIdx) => (
            <div
              key={dayIdx}
              className="relative rounded border border-ink-200 dark:border-ink-600"
              style={{ height: gridHeight }}
            >
              <HourGridLines startHour={startHour} endHour={endHour} />
              {busyPositions
                .filter((p) => p.dayIndex === dayIdx)
                .map((p, i) => (
                  <BusyBlock key={`b${i}`} block={p} />
                ))}
              {systemPositions
                .filter((p) => p.dayIndex === dayIdx)
                .map((p, i) => (
                  <SystemBlockView key={`s${i}`} block={p} />
                ))}
              {proposedPositions
                .filter((p) => p.dayIndex === dayIdx)
                .map((p, i) => (
                  <ProposedBlock key={`p${i}`} block={p} />
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Legend({ hasSleep, hasTravel }: { hasSleep: boolean; hasTravel: boolean }) {
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
      {hasTravel && (
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="block h-3 w-3 rounded-sm bg-amber-300/60 dark:bg-amber-400/40" />
          Travel
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
  label,
  dayIndex,
  weekStartMs,
  timezone
}: {
  label: string;
  dayIndex: number;
  weekStartMs: number;
  timezone: string;
}) {
  const dayMs = weekStartMs + dayIndex * 24 * 60 * 60 * 1000;
  const parts = partsInTimezone(dayMs, timezone);
  return (
    <div className="text-center text-xs">
      <div className="font-semibold">{label}</div>
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

function SystemBlockView({
  block
}: {
  block: PositionedBlock & { kind: SystemBlock["system"] };
}) {
  // Sleep gets a calm violet; travel gets a warm amber. Both sit between the
  // grey "existing" layer and the solid accent "proposed" layer in z-order so
  // the user reads them as platform-reserved time, not user-chosen blocks.
  const styles =
    block.kind === "sleep"
      ? "bg-indigo-200/70 text-indigo-900 dark:bg-indigo-500/30 dark:text-indigo-100"
      : "bg-amber-200/70 text-amber-900 dark:bg-amber-500/30 dark:text-amber-100";
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
  block
}: {
  block: PositionedBlock & { isSegment: boolean };
}) {
  return (
    <div
      title={`${block.title} (proposed)`}
      className={`absolute inset-x-0.5 overflow-hidden rounded px-1 py-0.5 text-[10px] font-medium text-accent-fg shadow-sm ${
        block.isSegment ? "bg-accent/70" : "bg-accent"
      }`}
      style={{ top: block.topPx, height: block.heightPx }}
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
