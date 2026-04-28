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

interface WeekCalendarProps {
  /** Monday 00:00 of the week being rendered, expressed as epoch ms. */
  weekStartMs: number;
  /** IANA timezone the user expects the grid to reflect (e.g. "Australia/Melbourne"). */
  timezone: string;
  /** Real busy events (Google etc.) to render as the back layer. */
  busy: readonly BusyEvent[];
  /** Planner's proposed blocks to render as the front layer. */
  proposed: readonly AllocatedBlock[];
  /** First hour shown on the grid (default 6). */
  startHour?: number;
  /** Last hour shown on the grid, exclusive (default 22). */
  endHour?: number;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PX_PER_HOUR = 40;

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
 * null when the entire interval lies outside the window or on a day other
 * than the seven we're showing.
 */
function position(
  startMs: number,
  endMs: number,
  weekStartMs: number,
  timezone: string,
  startHour: number,
  endHour: number,
  title: string
): PositionedBlock | null {
  // Normalise the start within the week we're showing: which day index?
  const startParts = partsInTimezone(startMs, timezone);
  const weekParts = partsInTimezone(weekStartMs, timezone);
  // Day index by counting whole local days between startParts and weekParts.
  // We approximate by composing local midnight ms via UTC and calendar math.
  const dayIndex = daysBetween(weekParts, startParts);
  if (dayIndex < 0 || dayIndex > 6) return null;

  const startMinuteOfDay = startParts.hour * 60 + startParts.minute;
  const durationMin = Math.max(15, Math.floor((endMs - startMs) / 60_000));
  const endMinuteOfDay = startMinuteOfDay + durationMin;

  const windowStart = startHour * 60;
  const windowEnd = endHour * 60;
  if (endMinuteOfDay <= windowStart) return null;
  if (startMinuteOfDay >= windowEnd) return null;

  const clippedTop = startMinuteOfDay < windowStart;
  const clippedBottom = endMinuteOfDay > windowEnd;
  const topMin = Math.max(windowStart, startMinuteOfDay);
  const bottomMin = Math.min(windowEnd, endMinuteOfDay);
  const topPx = ((topMin - windowStart) / 60) * PX_PER_HOUR;
  const heightPx = Math.max(8, ((bottomMin - topMin) / 60) * PX_PER_HOUR);

  return { dayIndex, topPx, heightPx, title, clippedTop, clippedBottom };
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
  startHour = 6,
  endHour = 22
}: WeekCalendarProps) {
  const totalHours = endHour - startHour;
  const gridHeight = totalHours * PX_PER_HOUR;

  // Build positioned arrays once, dropping events outside the window.
  const busyPositions = busy
    .map((b) => ({
      ...position(b.startMs, b.endMs, weekStartMs, timezone, startHour, endHour, b.title),
      busy: true
    }))
    .filter((p): p is PositionedBlock & { busy: true } => p !== null && "dayIndex" in p);

  const proposedPositions = proposed
    .map((b) => ({
      ...position(
        b.startMs,
        b.endMs,
        weekStartMs,
        timezone,
        startHour,
        endHour,
        b.title
      ),
      isSegment: Boolean(b.segment)
    }))
    .filter(
      (p): p is PositionedBlock & { isSegment: boolean } => p !== null && "dayIndex" in p
    );

  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <div className="font-semibold">This week</div>
        <Legend />
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[700px] grid-cols-[3rem_repeat(7,minmax(0,1fr))] gap-1">
          <div />
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

function Legend() {
  return (
    <div className="flex items-center gap-3 text-ink-400">
      <span className="inline-flex items-center gap-1">
        <span
          aria-hidden
          className="block h-3 w-3 rounded-sm border border-ink-300 bg-ink-200/70 dark:border-ink-600 dark:bg-ink-600/40"
        />
        Existing events
      </span>
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
