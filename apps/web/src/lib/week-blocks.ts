/**
 * Compute "system" blocks (sleep + travel) that surround the user's calendar
 * but aren't goals. They serve two purposes:
 *
 *   1. Visualisation — the dashboard week-grid renders them as a distinct
 *      layer so the user can see when sleep and drive-time are reserved.
 *   2. Goal allocation — they get folded back into the busy stream so the
 *      planner avoids scheduling goals on top of sleep or drive periods.
 *
 * The travel calculation is a pragmatic minimum port of the legacy Travel.gs
 * logic: events that carry a physical (non-virtual) location get pre-event
 * and post-event drive blocks of `settings.travel.fallbackDurationMinutes`.
 * The Apps Script does much more (Google Maps, traffic, weather adjustments)
 * but the goal here is to reflect drive time on the calendar, not to be
 * hour-perfect.
 */

import { placeSleepBlock } from "@calendar-automations/planner";
import type { BusyEvent } from "@calendar-automations/planner";
import type { SleepSettings, TravelSettings } from "@calendar-automations/schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface SystemBlock extends BusyEvent {
  /** Distinguishes which subsystem produced the block (for UI styling). */
  system: "sleep" | "travel";
  /** Optional UI hint (e.g. "Sleep (split)" or "Drive → Dentist"). */
  variant?: "split" | "underMinimum" | "drive-pre" | "drive-post";
}

/**
 * Returns drive blocks bracketing every busy event with a physical location.
 *
 * Skips events whose location matches the user's "virtual" substrings
 * (Teams, Zoom, Meet, etc.) and skips back-to-back collapses; the caller's
 * busy-stream merge handles overlap if drive blocks happen to touch.
 */
export function computeTravelBlocks(
  busy: readonly BusyEvent[],
  travel: TravelSettings
): SystemBlock[] {
  const driveMs = travel.fallbackDurationMinutes * 60 * 1000;
  if (driveMs <= 0) return [];
  const out: SystemBlock[] = [];

  for (const ev of busy) {
    if (!ev.location) continue;
    if (isVirtual(ev.location, travel.virtualLocationSubstrings)) continue;
    const tag = travel.driveEventTag || "[Drive]";
    out.push({
      sourceId: `${ev.sourceId}-drive-pre`,
      title: `${tag} → ${ev.title}`,
      startMs: ev.startMs - driveMs,
      endMs: ev.startMs,
      busy: true,
      source: "internal",
      system: "travel",
      variant: "drive-pre"
    });
    out.push({
      sourceId: `${ev.sourceId}-drive-post`,
      title: `${tag} ← ${ev.title}`,
      startMs: ev.endMs,
      endMs: ev.endMs + driveMs,
      busy: true,
      source: "internal",
      system: "travel",
      variant: "drive-post"
    });
  }
  return out;
}

function isVirtual(location: string, substrings: readonly string[]): boolean {
  const lower = location.toLowerCase();
  return substrings.some((s) => lower.includes(s.toLowerCase()));
}

/**
 * Compute sleep blocks for each night spanned by the week being rendered.
 *
 * `weekStartMs` is the user's local Monday midnight. We compute one night
 * window per ISO weekday, treating each night as starting at
 * `sleep.windowStartHour` on day N and ending at `sleep.windowEndHour` on
 * day N+1. The planner's `placeSleepBlock` finds the best position inside
 * that window given the busy stream.
 *
 * The DST handling is best-effort — we treat each day as 24h, which is
 * accurate except on the two transition days per year.
 */
export function computeSleepBlocks(
  weekStartMs: number,
  busy: readonly BusyEvent[],
  sleep: SleepSettings
): SystemBlock[] {
  const out: SystemBlock[] = [];

  for (let d = 0; d < 7; d++) {
    const dayStart = weekStartMs + d * DAY_MS;
    const nightStartMs = dayStart + sleep.windowStartHour * HOUR_MS;
    // The wake window ends on the next morning. When the configured end-hour
    // is "later" than the start-hour the window is same-day; otherwise it
    // crosses midnight.
    const endsNextDay = sleep.windowEndHour <= sleep.windowStartHour;
    const nightEndMs =
      dayStart + (endsNextDay ? DAY_MS : 0) + sleep.windowEndHour * HOUR_MS;
    if (nightEndMs <= nightStartMs) continue;

    const placed = placeSleepBlock(nightStartMs, nightEndMs, busy, sleep);
    for (const p of placed) {
      const variant: SystemBlock["variant"] = p.split
        ? "split"
        : p.underMinimum
          ? "underMinimum"
          : undefined;
      const block: SystemBlock = {
        sourceId: `sleep-${d}-${p.startMs}`,
        title: p.split ? "Sleep (split)" : "Sleep",
        startMs: p.startMs,
        endMs: p.endMs,
        busy: true,
        source: "internal",
        system: "sleep"
      };
      if (variant) block.variant = variant;
      out.push(block);
    }
  }
  return out;
}

/**
 * Convenience that bundles sleep + travel for a given week. Travel is
 * computed against the original busy stream first; sleep is then placed
 * against busy + travel so it doesn't conflict with drive-time.
 */
export function computeSystemBlocks(
  weekStartMs: number,
  busy: readonly BusyEvent[],
  sleep: SleepSettings,
  travel: TravelSettings
): SystemBlock[] {
  const travelBlocks = computeTravelBlocks(busy, travel);
  const busyWithTravel = [...busy, ...travelBlocks];
  const sleepBlocks = computeSleepBlocks(weekStartMs, busyWithTravel, sleep);
  return [...travelBlocks, ...sleepBlocks];
}
