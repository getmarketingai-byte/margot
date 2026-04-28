/**
 * Compute "system" blocks (sleep + travel) that surround the user's calendar
 * but aren't goals. They serve two purposes:
 *
 *   1. Visualisation — the dashboard week-grid renders them as a distinct
 *      layer so the user can see when sleep and drive-time are reserved.
 *   2. Goal allocation — they get folded back into the busy stream so the
 *      planner avoids scheduling goals on top of sleep or drive periods.
 *
 * The rules implemented here are a TypeScript port of the legacy `Sleep.gs`
 * and `Travel.gs` Apps Script logic. Specifically:
 *
 *   • **Travel**: physical-location events get a pre-event drive that ENDS
 *     `arriveMinutesBefore` before the event start (defaulting to 15 min)
 *     and a post-event drive starting immediately after. The drive duration
 *     is `fallbackDurationMinutes` since we don't have Maps API integration
 *     in the web app yet.
 *
 *   • **Sleep** ends at the user's `idealWakeHour:idealWakeMinute` on the
 *     wake day, or earlier if there is an outbound `[Drive] To:` event
 *     before that — wake gets pulled to `drive.start - bufferBeforeLeave`
 *     (rounded). Bedtime cannot start until any earlier `[Drive] Home`
 *     event ends + `bufferAfterDriveHome` (rounded). Past nights are
 *     skipped, events listed in `sleep.ignoreEventTitles` are filtered out
 *     of the sleep busy stream.
 */

import { placeSleepBlock } from "@calendar-automations/planner";
import type { BusyEvent } from "@calendar-automations/planner";
import type { SleepSettings, TimemapSettings, TravelSettings } from "@calendar-automations/schema";
import { localMidnightMs, partsInTimezone } from "./week";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export interface SystemBlock extends BusyEvent {
  /** Distinguishes which subsystem produced the block (for UI styling). */
  system: "sleep" | "travel" | "routine";
  /**
   * Optional UI hint:
   *   - "split" / "underMinimum"  — sleep
   *   - "drive-pre" / "drive-post" — travel
   *   - "morning" / "shutdown"    — routine
   */
  variant?:
    | "split"
    | "underMinimum"
    | "drive-pre"
    | "drive-post"
    | "morning"
    | "shutdown";
}

/**
 * Returns drive blocks bracketing every busy event with a physical location.
 *
 *   • drive-pre  ends `travel.arriveMinutesBefore` before the event start
 *     and lasts `fallbackDurationMinutes`. This mirrors the legacy
 *     "arrive 15 min early" rule from Travel.gs.
 *   • drive-post starts at the event end and lasts `fallbackDurationMinutes`.
 *
 * Skips events whose location matches the user's "virtual" substrings
 * (Teams, Zoom, Meet, etc.). Overlap with neighbouring drives is collapsed
 * downstream by `mergeIntervals` in the busy-stream layer.
 */
export function computeTravelBlocks(
  busy: readonly BusyEvent[],
  travel: TravelSettings
): SystemBlock[] {
  const driveMs = travel.fallbackDurationMinutes * MINUTE_MS;
  if (driveMs <= 0) return [];
  const arriveBufferMs = Math.max(0, travel.arriveMinutesBefore) * MINUTE_MS;
  const tag = travel.driveEventTag || "[Drive]";
  const out: SystemBlock[] = [];

  for (const ev of busy) {
    if (!ev.location) continue;
    if (isVirtual(ev.location, travel.virtualLocationSubstrings)) continue;

    const arriveBy = ev.startMs - arriveBufferMs;
    out.push({
      sourceId: `${ev.sourceId}-drive-pre`,
      title: `${tag} → ${ev.title}`,
      startMs: arriveBy - driveMs,
      endMs: arriveBy,
      busy: true,
      source: "internal",
      system: "travel",
      variant: "drive-pre",
      location: ev.location
    });
    out.push({
      sourceId: `${ev.sourceId}-drive-post`,
      title: `${tag} ← ${ev.title}`,
      startMs: ev.endMs,
      endMs: ev.endMs + driveMs,
      busy: true,
      source: "internal",
      system: "travel",
      variant: "drive-post",
      location: ev.location
    });
  }
  return out;
}

function isVirtual(location: string, substrings: readonly string[]): boolean {
  const lower = location.toLowerCase();
  return substrings.some((s) => lower.includes(s.toLowerCase()));
}

/**
 * Round an epoch ms to the nearest N-minute boundary anchored at midnight in
 * the user's timezone. Mirrors `_sleepRoundLocalTimeMs` from Sleep.gs.
 */
function roundLocalMs(ms: number, roundMinutes: number, timezone: string): number {
  if (!roundMinutes || roundMinutes <= 0) return ms;
  const p = partsInTimezone(ms, timezone);
  const dayStart = localMidnightMs(p.year, p.month, p.day, timezone);
  const minsSinceMidnight = (ms - dayStart) / MINUTE_MS;
  const rounded = Math.round(minsSinceMidnight / roundMinutes) * roundMinutes;
  return dayStart + rounded * MINUTE_MS;
}

/**
 * Compute sleep blocks for each night spanned by the week being rendered.
 *
 * Convention: night `d` (0..6) is the night that *starts* on day d of the
 * week. Sleep then ends on day d+1. The wake target is
 * `idealWakeHour:idealWakeMinute` on day d+1 in the user's timezone.
 *
 * Rules implemented (see Sleep.gs):
 *   1. Outbound `[Drive] To:` events on the wake day pull `targetEnd`
 *      earlier — never later — to `drive.start - bufferBeforeLeave`,
 *      rounded to `travelBufferRoundMinutes`.
 *   2. `[Drive] Home` events have their `endMs` extended by
 *      `bufferAfterDriveHome` (rounded) so sleep cannot start until that
 *      buffer has elapsed.
 *   3. Events whose title matches `sleep.ignoreEventTitles` (e.g. "Gym")
 *      do not block sleep.
 *   4. Nights whose `targetEnd` is in the past are skipped.
 */
export function computeSleepBlocks(
  weekStartMs: number,
  busy: readonly BusyEvent[],
  sleep: SleepSettings,
  timezone: string,
  nowMs: number = Date.now()
): SystemBlock[] {
  const out: SystemBlock[] = [];
  const ignoreTitles = (sleep.ignoreEventTitles ?? []).map((t) => t.toLowerCase());

  // Pre-bucket travel blocks for fast per-day lookup.
  const drivePre: BusyEvent[] = [];
  const driveHome: BusyEvent[] = [];
  for (const ev of busy) {
    const isInternal = ev.source === "internal";
    if (!isInternal) continue;
    const title = (ev.title || "").trim();
    if (title.startsWith("[Drive] →") || title.startsWith("[Drive] To:")) {
      drivePre.push(ev);
    } else if (
      title.startsWith("[Drive] ←") ||
      title === "[Drive] Home" ||
      title.startsWith("[Drive] Home")
    ) {
      driveHome.push(ev);
    }
  }

  const wakeBufferMs = sleep.bufferBeforeLeaveMinutes * MINUTE_MS;
  const homeBufferMs = sleep.bufferAfterDriveHomeMinutes * MINUTE_MS;
  const roundMin = sleep.travelBufferRoundMinutes;

  for (let d = 0; d < 7; d++) {
    const nightStartParts = partsInTimezone(weekStartMs + d * DAY_MS, timezone);
    const nightStartDayMs = localMidnightMs(
      nightStartParts.year,
      nightStartParts.month,
      nightStartParts.day,
      timezone
    );
    const wakeDayMs = nightStartDayMs + DAY_MS;
    const wakeDayParts = partsInTimezone(wakeDayMs, timezone);
    const wakeDayStart = localMidnightMs(
      wakeDayParts.year,
      wakeDayParts.month,
      wakeDayParts.day,
      timezone
    );

    const nightStartMs = nightStartDayMs + sleep.windowStartHour * HOUR_MS;
    const idealWakeMs =
      wakeDayStart + sleep.idealWakeHour * HOUR_MS + sleep.idealWakeMinute * MINUTE_MS;
    const windowEndCandidate = wakeDayStart + sleep.windowEndHour * HOUR_MS;
    const nightEndMs = Math.max(idealWakeMs, windowEndCandidate);
    if (nightEndMs <= nightStartMs) continue;

    let targetEndMs = idealWakeMs;
    const wakeDayEnd = wakeDayStart + DAY_MS;
    for (const drive of drivePre) {
      if (drive.startMs < wakeDayStart || drive.startMs >= wakeDayEnd) continue;
      if (drive.startMs >= idealWakeMs) continue;
      const wakeFromDrive = roundLocalMs(drive.startMs - wakeBufferMs, roundMin, timezone);
      if (wakeFromDrive < targetEndMs) targetEndMs = wakeFromDrive;
    }

    if (targetEndMs <= nowMs) continue;

    const sleepBusy: BusyEvent[] = [];
    for (const ev of busy) {
      if (ev.endMs <= nightStartMs || ev.startMs >= nightEndMs) continue;
      const titleLower = (ev.title || "").toLowerCase();
      if (ignoreTitles.includes(titleLower)) continue;
      sleepBusy.push(ev);
    }

    for (const drive of driveHome) {
      if (drive.endMs <= nightStartMs || drive.startMs >= nightEndMs) continue;
      const extendedEnd = roundLocalMs(drive.endMs + homeBufferMs, roundMin, timezone);
      sleepBusy.push({ ...drive, endMs: extendedEnd });
    }

    const placed = placeSleepBlock(nightStartMs, nightEndMs, sleepBusy, sleep, {
      targetEndMs
    });
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
 * Compute morning + shutdown routine blocks anchored on the placed sleep
 * blocks. Mirrors `_timeMapBuildRoutineOverlays` from `TimeMapBlocks.gs`:
 *
 *   • Morning routine = `morningRoutine.minutes` immediately AFTER each
 *     sleep block end (i.e. starts at wake).
 *   • Shutdown routine = `shutdownRoutine.minutes` immediately BEFORE each
 *     sleep block start (i.e. ends at bedtime).
 *
 * Blocks are clipped to `[weekStartMs, weekEndMs]` so the visualization
 * stays within the rendered week. Each routine has its own `enabled` flag;
 * passing a disabled routine returns no blocks for that side.
 */
export function computeRoutineBlocks(
  sleepBlocks: readonly SystemBlock[],
  timemap: TimemapSettings,
  weekStartMs: number,
  weekEndMs: number = weekStartMs + 7 * DAY_MS
): SystemBlock[] {
  const out: SystemBlock[] = [];
  const morning = timemap.morningRoutine;
  const shutdown = timemap.shutdownRoutine;
  const morningMs = morning.enabled ? morning.minutes * MINUTE_MS : 0;
  const shutdownMs = shutdown.enabled ? shutdown.minutes * MINUTE_MS : 0;
  if (morningMs <= 0 && shutdownMs <= 0) return out;

  for (const s of sleepBlocks) {
    if (s.system !== "sleep") continue;

    if (morningMs > 0) {
      const start = Math.max(s.endMs, weekStartMs);
      const end = Math.min(s.endMs + morningMs, weekEndMs);
      if (end > start) {
        out.push({
          sourceId: `${s.sourceId}-morning`,
          title: morning.title,
          startMs: start,
          endMs: end,
          busy: true,
          source: "internal",
          system: "routine",
          variant: "morning"
        });
      }
    }

    if (shutdownMs > 0) {
      const start = Math.max(s.startMs - shutdownMs, weekStartMs);
      const end = Math.min(s.startMs, weekEndMs);
      if (end > start) {
        out.push({
          sourceId: `${s.sourceId}-shutdown`,
          title: shutdown.title,
          startMs: start,
          endMs: end,
          busy: true,
          source: "internal",
          system: "routine",
          variant: "shutdown"
        });
      }
    }
  }
  return out;
}

/**
 * Convenience that bundles sleep + travel + routines for a given week.
 *
 *   1. Travel blocks are computed against the original busy stream.
 *   2. Sleep is placed against busy + travel so it respects drive-home
 *      wind-down and gets pulled earlier by outbound drives.
 *   3. Morning / shutdown routines are anchored on the placed sleep blocks.
 */
export function computeSystemBlocks(
  weekStartMs: number,
  busy: readonly BusyEvent[],
  sleep: SleepSettings,
  travel: TravelSettings,
  timezone: string,
  timemap?: TimemapSettings,
  nowMs: number = Date.now()
): SystemBlock[] {
  const travelBlocks = computeTravelBlocks(busy, travel);
  const busyWithTravel = [...busy, ...travelBlocks];
  const sleepBlocks = computeSleepBlocks(weekStartMs, busyWithTravel, sleep, timezone, nowMs);
  const routineBlocks = timemap
    ? computeRoutineBlocks(sleepBlocks, timemap, weekStartMs)
    : [];
  return [...travelBlocks, ...sleepBlocks, ...routineBlocks];
}
