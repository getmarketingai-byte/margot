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
 *   • Physical-activity / gym venue events match `settings.gym.title` **or**
 *     `settings.gym.blockLabel` (same trimmed casing) plus
 *     `gym.locationSubstring`, use `gym.driveMinutes` flat, and skip the
 *     arrive-before buffer (matches the legacy `_travelIsGymAshburton` path).
 *   • Direct-drive collapse: when time at home between two consecutive
 *     events would be `< minHomeMinutes`, emit one drive A→B instead of
 *     drive-home(A) + drive-pre(B).
 *   • Visual overlap collapse: when collapse can't be decided (no home or
 *     no real durations) and pre/post would visually overlap, merge them
 *     into one block. Pure visualisation fix; busy-stream is the same.
 */

import {
  formatSleepBlockTitle,
  gymTravelPadMinutesForGoal,
  mergeIntervals,
  PLANNER_TRAVEL_BUSY_CALENDAR,
  placeSleepBlock
} from "@calendar-automations/planner";
import type { AllocatedBlock, BusyEvent, Interval } from "@calendar-automations/planner";
import type {
  GymSettings,
  SleepSettings,
  TimemapSettings,
  TravelSettings,
  WeeklyGoal
} from "@calendar-automations/schema";
import { localMidnightMs, partsInTimezone } from "./week";
import { legKey, type LegResolver, type ResolveRequest } from "./routing";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** Logged sleep rows must overlap the night window by at least this much to suppress modeled sleep. */
const ACTUAL_SLEEP_NIGHT_OVERLAP_MS = 30 * MINUTE_MS;
/** Matches `computeSleepBlocks` / fingerprinting — always trim so titles from {@link computeTravelBlocks} align. */
function normaliseDriveEventTag(raw?: string | null): string {
  return (raw ?? "[Drive]").trim() || "[Drive]";
}

/**
 * Outbound drive leg titles. `includeDirect` is for scheduler-emitted blocks only
 * (`[Drive] <A> → <B>`) — do not use for external calendar rows (avoid false
 * positives on arbitrary "X → Y" summaries).
 */
function isOutboundDriveLegTitle(
  rawTitle: string,
  tag: string,
  mode: "strict" | "includeDirect"
): boolean {
  const t = rawTitle.trim();
  if (
    t.startsWith(`${tag} →`) ||
    t.startsWith(`${tag} To:`) ||
    t.startsWith(`${tag} ->`)
  ) {
    return true;
  }
  if (mode === "includeDirect" && t.startsWith(`${tag} `) && t.includes(" → ")) {
    return true;
  }
  return false;
}

function isInboundDriveLegTitle(rawTitle: string, tag: string): boolean {
  const t = rawTitle.trim();
  return (
    t.startsWith(`${tag} ←`) ||
    t.startsWith(`${tag} <-`) ||
    t === `${tag} Home` ||
    t.startsWith(`${tag} Home`)
  );
}

/**
 * Calendar rows that log real sleep (e.g. `[Sleep][Actual]` or `[Sleep] [Actual]`) — busy only.
 * Case-insensitive; tolerates whitespace between tags (collapsed check + substring fallback).
 */
export function isLoggedActualSleepTitle(title: string): boolean {
  const n = (title || "").trim().toLowerCase();
  if (!n.includes("[actual]")) return false;
  const collapsed = n.replace(/\s+/g, "");
  return collapsed.includes("[sleep][actual]") || (n.includes("[sleep]") && n.includes("[actual]"));
}

function loggedActualSleepIntervalsFromBusy(calendarBusy: readonly BusyEvent[]): Interval[] {
  const raw: Interval[] = [];
  for (const ev of calendarBusy) {
    if (!ev.busy) continue;
    if (!isLoggedActualSleepTitle(ev.title)) continue;
    if (ev.endMs <= ev.startMs) continue;
    raw.push({ startMs: ev.startMs, endMs: ev.endMs });
  }
  return mergeIntervals(raw);
}

/**
 * True for synthetic travel legs we emit (`computeTravelBlocks` / gym pads).
 * Used so internal non-drive busy (e.g. day-sheet logs, future proposed-as-busy)
 * never displaces modelled sleep — see ALLOCATOR_BUSINESS_RULES.md.
 */
function internalTravelDriveLeg(ev: BusyEvent, driveTag: string): boolean {
  if (ev.source !== "internal") return false;
  const tag = normaliseDriveEventTag(driveTag);
  const title = (ev.title || "").trim();
  return (
    isOutboundDriveLegTitle(title, tag, "includeDirect") ||
    isInboundDriveLegTitle(title, tag)
  );
}

function nightCoversLoggedActualSleep(
  nightStartMs: number,
  nightEndMs: number,
  busy: readonly BusyEvent[]
): boolean {
  for (const ev of busy) {
    if (!ev.busy) continue;
    if (!isLoggedActualSleepTitle(ev.title)) continue;
    const overlapStart = Math.max(ev.startMs, nightStartMs);
    const overlapEnd = Math.min(ev.endMs, nightEndMs);
    if (overlapEnd - overlapStart >= ACTUAL_SLEEP_NIGHT_OVERLAP_MS) return true;
  }
  return false;
}

export interface SystemBlock extends BusyEvent {
  /** Distinguishes which subsystem produced the block (for UI styling). */
  system: "sleep" | "travel" | "routine" | "weather" | "inverted-timemap";
  /**
   * When `system` is `inverted-timemap`, the planner goal id backing this
   * invert-free-busy calendar (used for colour + per-source toggles).
   */
  invertedGoalId?: string;
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
 *   • Each physical event gets a `drive-pre` (long enough to finish travel
 *     plus `arriveMinutesBefore` before the event start) and `drive-post`
 *     (starting at event end),
 *     each lasting either the resolver-supplied duration or
 *     `fallbackDurationMinutes`.
 *   • Gym / planner block-label events at the configured venue skip the
 *     arrive-before buffer and use a flat `gym.driveMinutes` (no provider call).
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
  const tag = normaliseDriveEventTag(travel.driveEventTag);
  const arriveBufferMs = Math.max(0, travel.arriveMinutesBefore) * MINUTE_MS;
  const minHomeMs = travel.minHomeMinutes * MINUTE_MS;
  const home = travel.homeAddress?.trim() || "";

  // 1. Filter physical events and sort by start time.
  // Only **busy** intervals count: transparent "free" rows with a venue still
  // carry a location and used to participate in direct-drive collapse. A
  // short free block ending just before a real appointment could merge into a
  // tiny `drive-direct` and skip the appointment's outbound `drive-pre` while
  // leaving `drive-post` — the mid-week symptom users saw in iCal.
  const physical: BusyEvent[] = [];
  for (const ev of busy) {
    if (!ev.location) continue;
    if (isVirtual(ev.location, travel.virtualLocationSubstrings)) continue;
    if (ev.busy === false) continue;
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
      // Zero-minute legs are dropped by ICS rendering (`endMs > startMs`); keep a floor.
      const driveMin = Math.max(1, legMin(home, ev.location!, fixed));
      const preEnd = ev.startMs;
      out.push({
        sourceId: `${ev.sourceId}-drive-pre`,
        title: `${tag} → ${ev.title}`,
        calendarDisplayName: PLANNER_TRAVEL_BUSY_CALENDAR,
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
      const postMin = Math.max(1, legMin(ev.location!, home, fixed));
      out.push({
        sourceId: `${ev.sourceId}-drive-post`,
        title: `${tag} ← ${ev.title}`,
        calendarDisplayName: PLANNER_TRAVEL_BUSY_CALENDAR,
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
        calendarDisplayName: PLANNER_TRAVEL_BUSY_CALENDAR,
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
    const postMin = Math.max(1, legMin(ev.location!, home, fixed));
    out.push({
      sourceId: `${ev.sourceId}-drive-post`,
      title: `${tag} ← ${ev.title}`,
      calendarDisplayName: PLANNER_TRAVEL_BUSY_CALENDAR,
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
 * True when an event is the configured physical-activity venue visit:
 * `gym.title` or `gym.blockLabel` (planner label, e.g. "Physical activity")
 * plus location containing `gym.locationSubstring`. Mirrors
 * `_travelIsGymAshburton` from `Travel.gs`.
 */
function isGymEvent(ev: BusyEvent, gym: GymSettings): boolean {
  if (!gym.enabled) return false;
  if (!ev.location) return false;
  const sub = (gym.locationSubstring || "").trim().toLowerCase();
  if (!sub) return false;
  if (!ev.location.toLowerCase().includes(sub)) return false;
  const title = (ev.title || "").trim().toLowerCase();
  const gymTitle = gym.title.trim().toLowerCase();
  if (title === gymTitle) return true;
  const blockLabel = (gym.blockLabel || "").trim().toLowerCase();
  return blockLabel.length > 0 && title === blockLabel;
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

/** Per-night override; `key` is night index 0..6 (Mon..Sun starts) or `7` (Sun→Mon into the week). */
export interface SleepOverride {
  key: number;
  startMs: number;
  endMs: number;
}

/**
 * Compute sleep blocks for each night spanned by the week being rendered.
 *
 * Convention: night `d` (0..6) is the night that *starts* on day d of the
 * week (Mon..Sun). Sleep then ends on day d+1. The wake target is
 * `idealWakeHour:idealWakeMinute` on day d+1 in the user's timezone.
 *
 * Additionally, night index **7** is the sleep that *wakes on the week's
 * first Monday* (local Sunday night → Monday morning). Without this, Monday
 * pre-wake hours would be missing from `busy` (they belong to the prior
 * calendar day, not to night d=0 which is Mon night → Tue wake).
 *
 * Rules implemented (see Sleep.gs):
 *   1. Outbound drive events on the wake day (`[Drive] To:`, `[Drive] →`, or
 *      direct `… → …` legs) pull `targetEnd` earlier — never later — rounded to
 *      `travelBufferRoundMinutes`. Let `tightWake = drive.start − morning routine`
 *      and `looseWake = drive.start − bufferBeforeLeave − morning routine`.
 *      When `tightWake` is on or before ideal wake (commute pulls you up or
 *      flush with ideal), use `tightWake` so morning routine ends when the
 *      drive starts (no gap for `bufferBeforeLeave` between routine and leave).
 *      Otherwise use `looseWake`. Drives that start *after* ideal wake still
 *      participate (each leg can only move wake earlier).
 *   2. Inbound `[Drive] ←` / Home legs: always enter the sleep busy stream; when
 *      shutdown routine is off, extend each leg's `endMs` by
 *      `bufferAfterDriveHomeMinutes`. When shutdown is on, pre-sleep wind-down is
 *      enforced only via `placeSleepBlock` `reserveBeforeSleepMs` (not also on
 *      the leg, to avoid double-counting).
 *   3. Events whose title matches `sleep.ignoreEventTitles` (e.g. "Gym")
 *      do not block sleep.
 *   4. Sleep is still placed for every night in the week window even when that
 *      night's wake (`targetEnd`) is already past. Those intervals stay in
 *      `busy` so full-week capacity metrics match intent (168h minus sleep,
 *      etc.). `allocateWeek` already avoids auto-packing goals into the past
 *      via `nowMs`; skipping nights here only inflated "available" time.
 *   5. A user-supplied override for night `d` is returned verbatim,
 *      bypassing the gap search entirely.
 *   6. When a busy calendar row title matches {@link isLoggedActualSleepTitle}
 *      (logged real sleep) and overlaps that night by ≥30m, modeled sleep is
 *      omitted — the calendar interval alone reserves time (no duplicate stack).
 *   7. When `timemap` is passed: enabled **morning routine** minutes are
 *      subtracted from outbound drive leave times when computing the wake
 *      target (sleep ends, then morning, then drive) and are passed as
 *      `reserveAfterSleepMs` when placing sleep. Enabled **shutdown** is
 *      `reserveBeforeSleepMs` (wider busy clip in the planner so time before the
 *      nominal sleep window can block the shutdown strip). Inbound drive legs do
 *      not add the same minutes again when shutdown is on.
 *   8. Internal busy that is **not** a travel/drive leg (`driveEventTag`, same
 *      shapes as {@link internalTravelDriveLeg}) is omitted from sleep collision
 *      so scheduler-owned rows cannot move modelled sleep; Google/ICS/Microsoft
 *      busy still can.
 */
export function computeSleepBlocks(
  weekStartMs: number,
  busy: readonly BusyEvent[],
  sleep: SleepSettings,
  timezone: string,
  nowMs: number = Date.now(),
  overrides: ReadonlyMap<number, SleepOverride> = new Map(),
  timemap?: TimemapSettings,
  driveEventTag: string = "[Drive]"
): SystemBlock[] {
  void nowMs;
  const out: SystemBlock[] = [];
  const ignoreTitles = (sleep.ignoreEventTitles ?? []).map((t) => t.toLowerCase());
  const tag = normaliseDriveEventTag(driveEventTag);

  // Pre-bucket travel blocks for fast per-day lookup.
  const drivePre: BusyEvent[] = [];
  const driveHome: BusyEvent[] = [];
  for (const ev of busy) {
    const title = (ev.title || "").trim();
    const outbound =
      ev.source === "internal"
        ? isOutboundDriveLegTitle(title, tag, "includeDirect")
        : isOutboundDriveLegTitle(title, tag, "strict");
    if (outbound) {
      drivePre.push(ev);
      continue;
    }
    if (isInboundDriveLegTitle(title, tag)) {
      driveHome.push(ev);
    }
  }

  const wakeBufferMs = sleep.bufferBeforeLeaveMinutes * MINUTE_MS;
  const homeBufferMs = sleep.bufferAfterDriveHomeMinutes * MINUTE_MS;
  const roundMin = sleep.travelBufferRoundMinutes;
  const morningPadMs =
    timemap?.morningRoutine.enabled === true ? timemap.morningRoutine.minutes * MINUTE_MS : 0;
  const shutdownPadMs =
    timemap?.shutdownRoutine.enabled === true ? timemap.shutdownRoutine.minutes * MINUTE_MS : 0;
  /**
   * After `[Drive] ←` / Home: extend busy by `bufferAfterDriveHomeMinutes` when
   * shutdown routine is off. When shutdown is on, the same wind-down is enforced
   * via `placeSleepBlock` `reserveBeforeSleepMs` (avoid double-counting).
   */
  const driveHomeWindDownMs = shutdownPadMs > 0 ? 0 : homeBufferMs;

  function appendSleepForNight(
    nightIndexLabel: string,
    nightStartDayMs: number,
    wakeDayStart: number,
    override: SleepOverride | undefined
  ): void {
    const nightStartMs = nightStartDayMs + sleep.windowStartHour * HOUR_MS;
    const idealWakeMs =
      wakeDayStart + sleep.idealWakeHour * HOUR_MS + sleep.idealWakeMinute * MINUTE_MS;
    const windowEndCandidate = wakeDayStart + sleep.windowEndHour * HOUR_MS;
    const nightEndMs = Math.max(idealWakeMs, windowEndCandidate);
    if (nightEndMs <= nightStartMs) return;

    let targetEndMs = idealWakeMs;
    const wakeDayEnd = wakeDayStart + DAY_MS;
    for (const drive of drivePre) {
      if (drive.startMs < wakeDayStart || drive.startMs >= wakeDayEnd) continue;
      // Every outbound drive on the wake day can only pull wake *earlier*
      // (never later). Skipping drives with `startMs > idealWakeMs` was wrong
      // — e.g. ideal 07:00 and leave 07:30 would ignore the commute and stack
      // sleep / morning routine on the drive.
      const looseWakeMs = roundLocalMs(
        drive.startMs - wakeBufferMs - morningPadMs,
        roundMin,
        timezone
      );
      const tightWakeMs = roundLocalMs(
        drive.startMs - morningPadMs,
        roundMin,
        timezone
      );
      const commutePacksRoutineFlush = tightWakeMs <= idealWakeMs;
      const wakeFromDriveMs = commutePacksRoutineFlush ? tightWakeMs : looseWakeMs;
      if (wakeFromDriveMs < targetEndMs) targetEndMs = wakeFromDriveMs;
    }

    if (
      !override &&
      nightCoversLoggedActualSleep(nightStartMs, nightEndMs, busy)
    ) {
      return;
    }

    const sleepBusy: BusyEvent[] = [];
    for (const ev of busy) {
      if (ev.endMs <= nightStartMs || ev.startMs >= nightEndMs) continue;
      const titleLower = (ev.title || "").toLowerCase();
      if (ignoreTitles.includes(titleLower)) continue;
      if (ev.source === "internal" && !internalTravelDriveLeg(ev, tag)) {
        continue;
      }
      sleepBusy.push(ev);
    }

    for (const drive of driveHome) {
      if (drive.endMs <= nightStartMs || drive.startMs >= nightEndMs) continue;
      const extendedEnd = roundLocalMs(
        drive.endMs + driveHomeWindDownMs,
        roundMin,
        timezone
      );
      sleepBusy.push({ ...drive, endMs: extendedEnd });
    }

    const placed = placeSleepBlock(nightStartMs, nightEndMs, sleepBusy, sleep, {
      targetEndMs,
      override: override ? { startMs: override.startMs, endMs: override.endMs } : undefined,
      reserveBeforeSleepMs: shutdownPadMs > 0 ? shutdownPadMs : undefined,
      reserveAfterSleepMs: morningPadMs > 0 ? morningPadMs : undefined
    });
    const primaryIdx = placed.findIndex((p) => !p.split);
    for (let pi = 0; pi < placed.length; pi++) {
      const p = placed[pi]!;
      const variant: SystemBlock["variant"] = p.split
        ? "split"
        : p.underMinimum
          ? "underMinimum"
          : undefined;
      const block: SystemBlock = {
        sourceId: `sleep-${nightIndexLabel}-${p.startMs}`,
        title: formatSleepBlockTitle(p, sleep.durationHours),
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
          key: nightIndexLabel,
          isOverridden: Boolean(override)
        };
      }
      out.push(block);
    }
  }

  // Sunday night → Monday morning (wake on the week's first local day).
  const weekAnchorParts = partsInTimezone(weekStartMs, timezone);
  const mondayMidnight = localMidnightMs(
    weekAnchorParts.year,
    weekAnchorParts.month,
    weekAnchorParts.day,
    timezone
  );
  const sundayProbeParts = partsInTimezone(mondayMidnight - 12 * HOUR_MS, timezone);
  const leadingNightStartDayMs = localMidnightMs(
    sundayProbeParts.year,
    sundayProbeParts.month,
    sundayProbeParts.day,
    timezone
  );
  const leadingOverride = overrides.get(7);
  appendSleepForNight("7", leadingNightStartDayMs, mondayMidnight, leadingOverride);

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

    appendSleepForNight(String(d), nightStartDayMs, wakeDayStart, override);
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
  // override keys stable across re-renders.
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

/**
 * Travel overlays for Perfect Week blocks whose goal is `specialGoalType:
 * "gym"`. Uses the same drive tag and quantised one-way minutes as the
 * allocator (`gymTravelPadMinutesForGoal` / `settings.gym.driveMinutes`).
 */
export function gymGoalTravelBlocksFromProposed(
  blocks: readonly AllocatedBlock[],
  goals: readonly WeeklyGoal[],
  travel: TravelSettings,
  gym: GymSettings
): SystemBlock[] {
  const tag = normaliseDriveEventTag(travel.driveEventTag);
  const goalById = new Map(goals.map((g) => [g.id, g] as const));
  const out: SystemBlock[] = [];
  for (const b of blocks) {
    if (b.segment) continue;
    const g = goalById.get(b.goalId);
    if (!g || g.specialGoalType !== "gym") continue;
    const padMin = gymTravelPadMinutesForGoal(g, gym);
    if (padMin <= 0) continue;
    const padMs = padMin * MINUTE_MS;
    out.push({
      sourceId: `${b.goalId}-${b.startMs}-gym-pre`,
      title: `${tag} → ${b.title}`,
      startMs: b.startMs - padMs,
      endMs: b.startMs,
      busy: true,
      source: "internal",
      system: "travel",
      variant: "drive-pre"
    });
    out.push({
      sourceId: `${b.goalId}-${b.startMs}-gym-post`,
      title: `${tag} ← ${b.title}`,
      startMs: b.endMs,
      endMs: b.endMs + padMs,
      busy: true,
      source: "internal",
      system: "travel",
      variant: "drive-post"
    });
  }
  return out;
}

/**
 * Sleep intervals for `allocateWeek({ sleepIntervals })` so day-sheet
 * (`source: "actual"`) pins cannot be honoured on top of computed sleep.
 */
export function sleepIntervalsFromSystemBlocks(
  blocks: readonly Pick<SystemBlock, "system" | "startMs" | "endMs">[]
): Array<{ startMs: number; endMs: number }> {
  return blocks.filter((b) => b.system === "sleep").map((b) => ({ startMs: b.startMs, endMs: b.endMs }));
}

/**
 * Merges modeled sleep (`systemBlocks`) with calendar `[Sleep][Actual]` busy rows
 * so pin overlap checks and weather sleep clipping match what blocks the week.
 */
/**
 * Removes synthetic wake-prep travel overlays (`title: "[Prep]"`, `sourceId` prefix
 * `wake-prep-`) left over from an older allocator or from cached server payloads.
 */
export function stripLegacyWakePrepSystemBlocks(blocks: readonly SystemBlock[]): SystemBlock[] {
  return blocks.filter(
    (b) =>
      !(
        b.system === "travel" &&
        b.source === "internal" &&
        (b.sourceId?.startsWith("wake-prep-") === true || (b.title ?? "").trim() === "[Prep]")
      )
  );
}

export function sleepIntervalsForAllocation(
  systemBlocks: readonly Pick<SystemBlock, "system" | "startMs" | "endMs">[],
  calendarBusy: readonly BusyEvent[]
): Interval[] {
  const fromSystem = sleepIntervalsFromSystemBlocks(systemBlocks);
  const fromCal = loggedActualSleepIntervalsFromBusy(calendarBusy);
  if (fromCal.length === 0) return fromSystem;
  if (fromSystem.length === 0) return fromCal;
  return mergeIntervals([...fromSystem, ...fromCal]);
}

/* ─────────────────────────── Combined entry point ───────────────────────── */

export interface SystemBlocksOverrides {
  /** Sleep override per night (0..6, plus 7 for the leading Sun→Mon night). */
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
 *      wind-down and gets pulled earlier by outbound drives. When
 *      `timemap` is present, morning minutes shrink the wake target before
 *      outbound drives and shutdown minutes reserve time after calendar
 *      events (and after drive-home buffer) before sleep may start. User
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
  const driveTag = normaliseDriveEventTag(travel.driveEventTag);
  const sleepBlocks = computeSleepBlocks(
    weekStartMs,
    busyWithTravel,
    sleep,
    timezone,
    nowMs,
    overrides.sleep,
    timemap,
    driveTag
  );
  const routineBlocks = timemap
    ? computeRoutineBlocks(sleepBlocks, timemap, weekStartMs, undefined, overrides.routine)
    : [];
  return [...travelBlocks, ...sleepBlocks, ...routineBlocks];
}
