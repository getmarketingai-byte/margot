import type { BusyEvent } from "./types";

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
