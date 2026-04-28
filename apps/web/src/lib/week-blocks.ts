/**
 * Compute "system" blocks (sleep + travel + routines) that surround the
 * user's calendar but aren't goals. They serve two purposes:
 *
 *   1. Visualisation — the dashboard week-grid renders them as a distinct
 *      layer so the user can see when sleep and drive-time are reserved.
 *   2. Goal allocation — they get folded back into the busy stream so the
 *      planner avoids scheduling goals on top of sleep or drive periods.
 *
 * The rules implemented here are a TypeScript port of the legacy `Sleep.gs`
 * and `Travel.gs` Apps Script logic. Travel now consults a `LegResolver`
 * (see `lib/routing`) for real drive durations, with three short-circuits:
 *
 *   • Gym events match `settings.gym.title` + `gym.locationSubstring` and
 *     use `gym.driveMinutes` flat with no arrive-before buffer (matches
 *     the legacy `_travelIsGymAshburton` path).
 *   • Direct-drive collapse: when time at home between two consecutive
 *     events would be `< minHomeMinutes`, emit one drive A→B instead of
 *     drive-home(A) + drive-pre(B).
 *   • Visual overlap collapse: when collapse can't be decided (no home or
 *     no real durations) and pre/post would visually overlap, merge them
 *     into one block. Pure visualisation fix; busy-stream is the same.
 */

import { placeSleepBlock } from "@calendar-automations/planner";
import type { BusyEvent } from "@calendar-automations/planner";
import type {
  GymSettings,
  SleepSettings,
  TimemapSettings,
  TravelSettings
} from "@calendar-automations/schema";
import { localMidnightMs, partsInTimezone } from "./week";
import { legKey, type LegResolver, type ResolveRequest } from "./routing";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export interface SystemBlock extends BusyEvent {
  /** Distinguishes which subsystem produced the block (for UI styling). */
  system: "sleep" | "travel" | "routine";
  /**
   * Optional UI hint:
   *   - "split" / "underMinimum"  — sleep
   *   - "drive-pre" / "drive-post" / "drive-direct" — travel
   *   - "morning" / "shutdown"    — routine
   */
  variant?:
    | "split"
    | "underMinimum"
    | "drive-pre"
    | "drive-post"
    | "drive-direct"
    | "morning"
    | "shutdown";
  /**
   * Override metadata for sleep + routine blocks. When present the calendar
   * renders an interactive draggable block that calls `setBlockOverride` /
   * `clearBlockOverride` on release. Travel blocks omit this.
   */
  override?: {
    kind: "sleep" | "routine";
    /** Identifies the original computed block — see `BlockOverride.key`. */
    key: string;
    /** True when the user has dragged this block away from its natural time. */
    isOverridden: boolean;
  };
}

/* ─────────────────────────────── Travel ──────────────────────────────────── */

/**
 * Returns drive blocks bracketing every busy event with a physical location.
 *
 * Behaviour summary:
 *   • Each physical event gets a `drive-pre` (ending `arriveMinutesBefore`
 *     before the event start) and `drive-post` (starting at event end),
 *     each lasting either the resolver-supplied duration or
 *     `fallbackDurationMinutes`.
 *   • Gym events skip the arrive-before buffer and use a flat
 *     `gym.driveMinutes` (free, no provider call).
 *   • Two consecutive events that don't allow `minHomeMinutes` at home in
 *     between get a single direct drive replacing the pair of home-legs.
 *   • Even without a resolver, overlapping post(A) + pre(B) blocks are
 *     visually merged so the calendar doesn't show stacked drives.
 */
export async function computeTravelBlocks(
  busy: readonly BusyEvent[],
  travel: TravelSettings,
  gym: GymSettings,
  resolver: LegResolver
): Promise<SystemBlock[]> {
  const fallbackMs = travel.fallbackDurationMinutes * MINUTE_MS;
  if (fallbackMs <= 0) return [];
  const tag = travel.driveEventTag || "[Drive]";
  const arriveBufferMs = Math.max(0, travel.arriveMinutesBefore) * MINUTE_MS;
  const minHomeMs = travel.minHomeMinutes * MINUTE_MS;
  const home = travel.homeAddress?.trim() || "";

  // 1. Filter physical events and sort by start time.
  const physical: BusyEvent[] = [];
  for (const ev of busy) {
    if (!ev.location) continue;
    if (isVirtual(ev.location, travel.virtualLocationSubstrings)) continue;
    physical.push(ev);
  }
  physical.sort((a, b) => a.startMs - b.startMs);
  if (physical.length === 0) return [];

  // 2. Identify gym events; their drive duration is fixed and the resolver
  //    short-circuits without a provider call.
  function gymFixedMin(ev: BusyEvent): number | undefined {
    return isGymEvent(ev, gym) ? gym.driveMinutes : undefined;
  }

  // 3. Build the resolver request list. We need home↔location for every
  //    event plus location↔location for consecutive events (for the
  //    direct-drive collapse decision).
  const requests: ResolveRequest[] = [];
  if (home) {
    for (const ev of physical) {
      const fixed = gymFixedMin(ev);
      requests.push({
        origin: home,
        dest: ev.location!,
        priorityTimeMs: ev.startMs,
        fixedMinutes: fixed
      });
      requests.push({
        origin: ev.location!,
        dest: home,
        priorityTimeMs: ev.endMs,
        fixedMinutes: fixed
      });
    }
    for (let i = 0; i < physical.length - 1; i++) {
      const a = physical[i]!;
      const b = physical[i + 1]!;
      requests.push({
        origin: a.location!,
        dest: b.location!,
        priorityTimeMs: b.startMs
      });
    }
  }
  const durations = await resolver.resolveMany(requests);

  function lookup(origin: string, dest: string): number | null {
    if (!origin || !dest) return null;
    const v = durations.get(legKey(origin, dest));
    return v == null ? null : v;
  }
  function legMin(origin: string, dest: string, fixed?: number): number {
    if (fixed != null) return fixed;
    if (!home) return travel.fallbackDurationMinutes;
    return lookup(origin, dest) ?? travel.fallbackDurationMinutes;
  }

  // 4. Walk events in order. For each event we decide whether the gap to
  //    the NEXT event collapses into a direct drive — either because real
  //    durations say "no time at home" or because the fallback durations
  //    would visually stack onto each other. When we collapse, we emit
  //    one direct block now and skip both the post-leg of this event and
  //    the pre-leg of the next event (tracked via `directIntoNext`).
  const out: SystemBlock[] = [];
  let directIntoNext = false;

  for (let i = 0; i < physical.length; i++) {
    const ev = physical[i]!;
    const next = i < physical.length - 1 ? physical[i + 1]! : null;
    const fixed = gymFixedMin(ev);
    const isGym = fixed != null;
    const evArriveBuffer = isGym ? 0 : arriveBufferMs;

    // --- drive-pre (skipped if prev iter emitted a direct drive INTO us)
    // Reserve both travel time AND the configured arrive-early buffer so
    // planner blocks cannot be squeezed between "drive done" and event start.
    if (!directIntoNext) {
      const driveMin = legMin(home, ev.location!, fixed);
      const preEnd = ev.startMs;
      out.push({
        sourceId: `${ev.sourceId}-drive-pre`,
        title: `${tag} → ${ev.title}`,
        startMs: preEnd - (driveMin * MINUTE_MS + evArriveBuffer),
        endMs: preEnd,
        busy: true,
        source: "internal",
        system: "travel",
        variant: "drive-pre",
        location: ev.location
      });
    }
    directIntoNext = false;

    if (!next) {
      // Last physical event of the week → always emit a post-leg home.
      const postMin = legMin(ev.location!, home, fixed);
      out.push({
        sourceId: `${ev.sourceId}-drive-post`,
        title: `${tag} ← ${ev.title}`,
        startMs: ev.endMs,
        endMs: ev.endMs + postMin * MINUTE_MS,
        busy: true,
        source: "internal",
        system: "travel",
        variant: "drive-post",
        location: ev.location
      });
      continue;
    }

    // --- collapse decision for the gap ev → next
    const nextFixed = gymFixedMin(next);
    const nextArriveBuffer = nextFixed != null ? 0 : arriveBufferMs;
    const decision = decideCollapse({
      a: ev,
      b: next,
      lookup,
      home,
      arriveBufferA: 0, // post-leg from A starts at A.end regardless
      arriveBufferB: nextArriveBuffer,
      minHomeMs,
      aPostMinFallback: legMin(ev.location!, home, fixed),
      bPreMinFallback: legMin(home, next.location!, nextFixed)
    });

    if (decision.collapse) {
      out.push({
        sourceId: `${ev.sourceId}-direct-${next.sourceId}`,
        title: `${tag} ${ev.title} → ${next.title}`,
        startMs: decision.startMs,
        endMs: decision.endMs,
        busy: true,
        source: "internal",
        system: "travel",
        variant: "drive-direct",
        location: next.location
      });
      directIntoNext = true;
      continue;
    }

    // No collapse → normal drive-post.
    const postMin = legMin(ev.location!, home, fixed);
    out.push({
      sourceId: `${ev.sourceId}-drive-post`,
      title: `${tag} ← ${ev.title}`,
      startMs: ev.endMs,
      endMs: ev.endMs + postMin * MINUTE_MS,
      busy: true,
      source: "internal",
      system: "travel",
      variant: "drive-post",
      location: ev.location
    });
  }

  return out;
}

interface CollapseDecisionInput {
  a: BusyEvent;
  b: BusyEvent;
  lookup: (origin: string, dest: string) => number | null;
  home: string;
  /** Arrive-buffer at A (currently always 0; A's post-leg starts at A.end). */
  arriveBufferA: number;
  /** Arrive-buffer at B (0 for gym, settings default otherwise). */
  arriveBufferB: number;
  /** Minimum minutes at home (in ms) below which we collapse. */
  minHomeMs: number;
  /** Fallback drive duration A → home (minutes), used when no provider. */
  aPostMinFallback: number;
  /** Fallback drive duration home → B (minutes), used when no provider. */
  bPreMinFallback: number;
}

type CollapseDecision =
  | { collapse: false }
  | { collapse: true; startMs: number; endMs: number };

/**
 * Decide whether the gap between consecutive physical events A and B should
 * collapse into a single direct drive A → B. Two paths:
 *
 *   1. **Real durations**: when home + provider give us A→home, home→B and
 *      A→B, compute time at home. If `< minHomeMinutes`, collapse and use
 *      the real A→B duration ending at B's arrive-by time.
 *   2. **Visual fallback**: without enough data for path 1, check whether
 *      the fallback drive-post(A) and drive-pre(B) blocks would visually
 *      stack (start before each other ends). If so, collapse into a single
 *      block filling the entire gap from A.end to B.start.
 *
 * The fallback path is what kept the calendar messy for users without an
 * API key configured — events 90 minutes apart with 60 min fallback drives
 * would render as overlapping pre+post blocks. Collapsing into one
 * gap-filling block matches the "you're driving" reality.
 */
function decideCollapse(input: CollapseDecisionInput): CollapseDecision {
  const { a, b, lookup, home, arriveBufferA, arriveBufferB, minHomeMs } = input;
  const eventStartB = b.startMs;
  const arriveAtB = eventStartB - arriveBufferB;
  const aEnd = a.endMs + arriveBufferA;
  if (eventStartB <= aEnd) return { collapse: false };

  if (home) {
    const aToHome = lookup(a.location!, home);
    const homeToB = lookup(home, b.location!);
    const aToB = lookup(a.location!, b.location!);
    if (aToHome != null && homeToB != null && aToB != null) {
      const timeAtHomeMs = arriveAtB - aEnd - (aToHome + homeToB) * MINUTE_MS;
      if (timeAtHomeMs < minHomeMs) {
        return {
          collapse: true,
          startMs: eventStartB - (aToB * MINUTE_MS + arriveBufferB),
          endMs: eventStartB
        };
      }
      return { collapse: false };
    }
  }

  // Visual fallback — would the two fallback drives overlap?
  const postEnd = aEnd + input.aPostMinFallback * MINUTE_MS;
  const preStart = eventStartB - (input.bPreMinFallback * MINUTE_MS + arriveBufferB);
  if (preStart < postEnd) {
    // Fill the whole gap from A.end through to B.start.
    return { collapse: true, startMs: aEnd, endMs: eventStartB };
  }
  return { collapse: false };
}

function isVirtual(location: string, substrings: readonly string[]): boolean {
  const lower = location.toLowerCase();
  return substrings.some((s) => lower.includes(s.toLowerCase()));
}

/**
 * True when an event matches the configured Gym title + location. Mirrors
 * `_travelIsGymAshburton` from `Travel.gs`.
 */
function isGymEvent(ev: BusyEvent, gym: GymSettings): boolean {
  if (!gym.enabled) return false;
  if (!ev.location) return false;
  const title = (ev.title || "").trim();
  if (title.toLowerCase() !== gym.title.trim().toLowerCase()) return false;
  const sub = (gym.locationSubstring || "").trim().toLowerCase();
  if (!sub) return false;
  return ev.location.toLowerCase().includes(sub);
}

/* ─────────────────────────────── Sleep ───────────────────────────────────── */

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

/** Per-night override; `key` is the night index 0..6 of the rendered week. */
export interface SleepOverride {
  key: number;
  startMs: number;
  endMs: number;
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
 *   5. A user-supplied override for night `d` is returned verbatim,
 *      bypassing the gap search entirely.
 */
export function computeSleepBlocks(
  weekStartMs: number,
  busy: readonly BusyEvent[],
  sleep: SleepSettings,
  timezone: string,
  nowMs: number = Date.now(),
  overrides: ReadonlyMap<number, SleepOverride> = new Map()
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
    if (
      title.startsWith("[Drive] →") ||
      title.startsWith("[Drive] To:") ||
      title.includes(" → ") // drive-direct also pulls wake earlier
    ) {
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
    const override = overrides.get(d);

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

    // Past-night skip applies only when there's no override; an explicit
    // override (e.g. recording last night's actual sleep) is honoured even
    // when the window has elapsed.
    if (!override && targetEndMs <= nowMs) continue;

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
      targetEndMs,
      override: override ? { startMs: override.startMs, endMs: override.endMs } : undefined
    });
    // Only the primary (non-split) night block is overridable — split fallbacks
    // are an emergency placement and dragging one half doesn't make sense.
    const primaryIdx = placed.findIndex((p) => !p.split);
    for (let pi = 0; pi < placed.length; pi++) {
      const p = placed[pi]!;
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
      if (pi === primaryIdx) {
        block.override = {
          kind: "sleep",
          key: String(d),
          isOverridden: Boolean(override)
        };
      }
      out.push(block);
    }
  }
  return out;
}

/* ────────────────────────────── Routines ─────────────────────────────────── */

/** Routine override; `key` is `morning-${nightIdx}` / `shutdown-${nightIdx}`. */
export interface RoutineOverride {
  key: string;
  startMs: number;
  endMs: number;
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
 * A user override (matched by key) replaces the computed start/end while
 * preserving the link back to the night's sleep block.
 */
export function computeRoutineBlocks(
  sleepBlocks: readonly SystemBlock[],
  timemap: TimemapSettings,
  weekStartMs: number,
  weekEndMs: number = weekStartMs + 7 * DAY_MS,
  overrides: ReadonlyMap<string, RoutineOverride> = new Map()
): SystemBlock[] {
  const out: SystemBlock[] = [];
  const morning = timemap.morningRoutine;
  const shutdown = timemap.shutdownRoutine;
  const morningMs = morning.enabled ? morning.minutes * MINUTE_MS : 0;
  const shutdownMs = shutdown.enabled ? shutdown.minutes * MINUTE_MS : 0;
  if (morningMs <= 0 && shutdownMs <= 0) return out;

  // Routine indices are tied to the sleep block's night index (extracted
  // from the sleepBlock sourceId pattern `sleep-${d}-...`). This keeps
  // override keys stable across re-renders even if e.g. a night was
  // skipped (past-night) earlier in the list.
  for (const s of sleepBlocks) {
    if (s.system !== "sleep") continue;
    if (!s.override) continue; // split halves don't get routines wrapping them
    const idx = Number(s.override.key);
    if (!Number.isFinite(idx)) continue;

    if (morningMs > 0) {
      const overrideKey = `morning-${idx}`;
      const override = overrides.get(overrideKey);
      const start = override
        ? Math.max(override.startMs, weekStartMs)
        : Math.max(s.endMs, weekStartMs);
      const end = override
        ? Math.min(override.endMs, weekEndMs)
        : Math.min(s.endMs + morningMs, weekEndMs);
      if (end > start) {
        out.push({
          sourceId: `${s.sourceId}-morning`,
          title: morning.title,
          startMs: start,
          endMs: end,
          busy: true,
          source: "internal",
          system: "routine",
          variant: "morning",
          override: {
            kind: "routine",
            key: overrideKey,
            isOverridden: Boolean(override)
          }
        });
      }
    }

    if (shutdownMs > 0) {
      const overrideKey = `shutdown-${idx}`;
      const override = overrides.get(overrideKey);
      const start = override
        ? Math.max(override.startMs, weekStartMs)
        : Math.max(s.startMs - shutdownMs, weekStartMs);
      const end = override
        ? Math.min(override.endMs, weekEndMs)
        : Math.min(s.startMs, weekEndMs);
      if (end > start) {
        out.push({
          sourceId: `${s.sourceId}-shutdown`,
          title: shutdown.title,
          startMs: start,
          endMs: end,
          busy: true,
          source: "internal",
          system: "routine",
          variant: "shutdown",
          override: {
            kind: "routine",
            key: overrideKey,
            isOverridden: Boolean(override)
          }
        });
      }
    }
  }
  return out;
}

/* ─────────────────────────── Combined entry point ───────────────────────── */

export interface SystemBlocksOverrides {
  /** Sleep override per night (0..6). */
  sleep?: ReadonlyMap<number, SleepOverride>;
  /** Routine overrides keyed by `morning-${i}` or `shutdown-${i}`. */
  routine?: ReadonlyMap<string, RoutineOverride>;
}

/**
 * Convenience that bundles travel + sleep + routines for a given week.
 *
 *   1. Travel blocks are computed against the original busy stream, with
 *      the resolver providing real durations where available.
 *   2. Sleep is placed against busy + travel so it respects drive-home
 *      wind-down and gets pulled earlier by outbound drives. User
 *      overrides (per-night) bypass the gap search.
 *   3. Morning / shutdown routines are anchored on the placed sleep
 *      blocks; user overrides (per routine) replace the computed time.
 */
export async function computeSystemBlocks(
  weekStartMs: number,
  busy: readonly BusyEvent[],
  sleep: SleepSettings,
  travel: TravelSettings,
  gym: GymSettings,
  timezone: string,
  resolver: LegResolver,
  timemap?: TimemapSettings,
  overrides: SystemBlocksOverrides = {},
  nowMs: number = Date.now()
): Promise<SystemBlock[]> {
  const travelBlocks = await computeTravelBlocks(busy, travel, gym, resolver);
  const busyWithTravel = [...busy, ...travelBlocks];
  const sleepBlocks = computeSleepBlocks(
    weekStartMs,
    busyWithTravel,
    sleep,
    timezone,
    nowMs,
    overrides.sleep
  );
  const routineBlocks = timemap
    ? computeRoutineBlocks(sleepBlocks, timemap, weekStartMs, undefined, overrides.routine)
    : [];
  return [...travelBlocks, ...sleepBlocks, ...routineBlocks];
}
