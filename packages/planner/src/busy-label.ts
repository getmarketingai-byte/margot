import type { BusyEvent } from "./types";

/** Synthetic travel rows from `computeTravelBlocks` have no Google calendar id. */
const PLANNER_TRAVEL_BUSY_CALENDAR = "Planner travel";

/**
 * Calendar-facing label: prefer event title; for empty summaries show the
 * source calendar display name so untitled blocks can be traced.
 */
export function displayBusyEventLabel(
  ev: Pick<BusyEvent, "title" | "calendarDisplayName">
): string {
  const raw = (ev.title || "").trim();
  if (raw.length > 0) return raw;
  const cal = (ev.calendarDisplayName || "").trim();
  if (cal.length > 0) return `(no title · ${cal})`;
  return "(no title)";
}

/**
 * Label for sleep conflict copy: **always** suffix the calendar that owns the
 * busy interval when known (`calendarDisplayName` from the calendar source).
 * Internal planner travel uses {@link PLANNER_TRAVEL_BUSY_CALENDAR}.
 */
export function sleepConflictBusyLabel(
  ev: Pick<BusyEvent, "title" | "calendarDisplayName" | "source">
): string {
  const raw = (ev.title || "").trim();
  const cal = (ev.calendarDisplayName || "").trim();
  const suffix =
    cal || (ev.source === "internal" ? PLANNER_TRAVEL_BUSY_CALENDAR : "");

  if (!raw) {
    if (suffix) return `(no title · ${suffix})`;
    return "(no title)";
  }
  if (suffix) return `${raw} · ${suffix}`;
  return raw;
}

export { PLANNER_TRAVEL_BUSY_CALENDAR };
