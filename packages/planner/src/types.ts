/**
 * Shared planner domain types. Pure data — no Calendar API or DOM bindings.
 */

export interface Interval {
  startMs: number;
  endMs: number;
}

export interface BusyEvent extends Interval {
  /** Stable id from the source calendar; used to suppress duplicates across feeds. */
  sourceId: string;
  title: string;
  /**
   * User-facing calendar name for the feed (e.g. Google `displayName`), used when
   * `title` is empty so grids and sleep diagnostics remain traceable.
   */
  calendarDisplayName?: string;
  /** Free-busy availability hint from source. */
  busy: boolean;
  location?: string;
  /** Provider tag — useful for SkedPal-style transparency rules. */
  source: "google" | "microsoft" | "ics" | "internal";
}

export interface DayWindow {
  /** Local date key in YYYY-MM-DD form (planner timezone). */
  dateKey: string;
  startMs: number;
  endMs: number;
}
