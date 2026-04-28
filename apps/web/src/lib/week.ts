/**
 * Timezone-aware week math used by the dashboard pages.
 *
 * `localMondayMidnightMs` returns the actual epoch ms at which the user's
 * Monday begins in their own timezone. The allocator and the visual week-grid
 * both anchor on this value so Google events and proposed blocks land on the
 * same row of the same day.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6
};

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
 * Return the epoch ms for `year-month-day 00:00` interpreted in `timezone`.
 *
 * Approach: start with UTC midnight on that calendar date, then refine the
 * guess by reading back what timezone-aware formatting reports and correcting
 * for the offset. Two iterations are sufficient even across DST gaps.
 */
function localMidnightMs(year: number, month: number, day: number, timezone: string): number {
  let guess = Date.UTC(year, month - 1, day);
  for (let i = 0; i < 3; i++) {
    const parts = partsInTimezone(guess, timezone);
    const guessFormattedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute
    );
    const target = Date.UTC(year, month - 1, day, 0, 0);
    const drift = guessFormattedAsUtc - target;
    if (drift === 0) break;
    guess -= drift;
  }
  return guess;
}

/**
 * Epoch ms at which Monday 00:00 begins in the user's timezone. Used as the
 * canonical "this week starts here" reference for both display and allocation.
 */
export function localMondayMidnightMs(timezone: string, reference = new Date()): number {
  const parts = partsInTimezone(reference.getTime(), timezone);
  const dow = WEEKDAY_INDEX[parts.weekday] ?? 0;
  // Start from the user's local "today" calendar date.
  const todayMidnight = localMidnightMs(parts.year, parts.month, parts.day, timezone);
  return todayMidnight - dow * DAY_MS;
}

/**
 * "YYYY-MM-DD" form of the local Monday — what the planner stores in
 * `plan.weekStart`. Kept here so all callers use the same TZ-aware value.
 */
export function localMondayIso(timezone: string, reference = new Date()): string {
  const ms = localMondayMidnightMs(timezone, reference);
  const parts = partsInTimezone(ms, timezone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}
