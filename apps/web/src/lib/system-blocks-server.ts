/**
 * Server-only orchestration around travel + sleep + routine blocks.
 *
 * Wraps the render-time concerns (build a resolver, compute overlays,
 * persist freshly-fetched durations to the cache) so dashboard pages can
 * call a single function. Keeps the routing/cache plumbing out of page
 * components.
 *
 * Reading and writing both happen against `loadSettings(userId)`. Because a
 * server render is one short-lived request the in-flight settings copy is
 * authoritative for the whole render, so saving back with the new
 * `travelCache` slice doesn't risk clobbering other slices.
 *
 * Pass {@link BuildSystemBlocksArgs.travelResolver} when the caller needs one
 * resolver across multiple passes (e.g. this week + next week) so all resolved
 * legs flush once to `travelCache`.
 *
 * Sleep and morning/shutdown routine geometry are cached in Postgres per ISO
 * week whenever `DATABASE_URL` is set: travel blocks are always recomputed,
 * then we reuse stored sleep+routines when the fingerprint of calendar busy,
 * travel overlays, sleep settings, routine minutes, and overrides matches.
 */

import "server-only";

import type {
  GymSettings,
  SleepSettings,
  TimemapSettings,
  TravelSettings,
  WeeklyPlan,
  UserSettings
} from "@calendar-automations/schema";
import type { BusyEvent } from "@calendar-automations/planner";
import { saveSettings } from "./settings-store";
import {
  computeRoutineBlocks,
  computeSleepBlocks,
  computeTravelBlocks,
  computeWakePrepReservedBlocks,
  type SystemBlock,
  type SystemBlocksOverrides
} from "./week-blocks";
import { createLegResolver, type LegResolver } from "./routing";
import { isoCalendarDay } from "./week";
import { db } from "@/lib/db";
import {
  fingerprintSleepRoutineInputs,
  saveSleepRoutineCache,
  trySleepRoutineCacheHit
} from "./system-sleep-routine-cache";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface BuildSystemBlocksArgs {
  userId: string;
  settings: UserSettings;
  weekStartMs: number;
  busy: readonly BusyEvent[];
  /** Optional overrides pulled from the active WeeklyPlan. */
  overrides?: SystemBlocksOverrides;
  nowMs?: number;
  /**
   * When set, drive-duration lookups accumulate here and this helper skips
   * persisting — the caller must flush with {@link LegResolver.takeCacheUpdates}
   * (e.g. after computing next week with the same resolver).
   */
  travelResolver?: LegResolver;
}

/**
 * Travel + sleep + routines for one week. Travel runs every time; sleep+routines
 * may be replayed from `system_sleep_routine_cache` when inputs match.
 */
export async function computeSystemBlocksWithSleepRoutineCache(options: {
  userId: string;
  weekStartMs: number;
  busy: readonly BusyEvent[];
  sleep: SleepSettings;
  travel: TravelSettings;
  gym: GymSettings;
  timezone: string;
  resolver: LegResolver;
  timemap?: TimemapSettings;
  overrides?: SystemBlocksOverrides;
  nowMs?: number;
}): Promise<SystemBlock[]> {
  const {
    userId,
    weekStartMs,
    busy,
    sleep,
    travel,
    gym,
    timezone,
    resolver,
    timemap,
    overrides = {},
    nowMs = Date.now()
  } = options;

  const travelBlocks = await computeTravelBlocks(busy, travel, gym, resolver);
  const busyWithTravel = [...busy, ...travelBlocks];
  const driveTag = (travel.driveEventTag || "[Drive]").trim() || "[Drive]";
  const weekStartIso = isoCalendarDay(weekStartMs, timezone);

  const fp = fingerprintSleepRoutineInputs({
    busy,
    travelBlocks,
    sleep,
    timemap,
    gym,
    travel,
    overrides,
    weekStartMs,
    timezone,
    driveTag
  });

  const cached = await trySleepRoutineCacheHit(userId, weekStartIso, fp);
  if (cached) {
    const wakePrepBlocks = computeWakePrepReservedBlocks(
      travelBlocks,
      cached.sleepBlocks,
      cached.routineBlocks,
      weekStartMs,
      weekStartMs + WEEK_MS,
      timezone,
      driveTag
    );
    return [...travelBlocks, ...cached.sleepBlocks, ...cached.routineBlocks, ...wakePrepBlocks];
  }

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
  const wakePrepBlocks = computeWakePrepReservedBlocks(
    travelBlocks,
    sleepBlocks,
    routineBlocks,
    weekStartMs,
    weekStartMs + WEEK_MS,
    timezone,
    driveTag
  );

  if (db) {
    await saveSleepRoutineCache({
      userId,
      weekStartIso,
      fingerprint: fp,
      sleepBlocks,
      routineBlocks
    });
  }

  return [...travelBlocks, ...sleepBlocks, ...routineBlocks, ...wakePrepBlocks];
}

export async function buildSystemBlocks(
  args: BuildSystemBlocksArgs
): Promise<SystemBlock[]> {
  const { userId, settings, weekStartMs, busy, overrides, nowMs, travelResolver } = args;
  const resolver =
    travelResolver ??
    createLegResolver({
      travel: settings.travel,
      cache: settings.travelCache
    });

  const blocks = await computeSystemBlocksWithSleepRoutineCache({
    userId,
    weekStartMs,
    busy,
    sleep: settings.sleep,
    travel: settings.travel,
    gym: settings.gym,
    timezone: settings.timezone,
    resolver,
    timemap: settings.timemap,
    overrides,
    nowMs
  });

  // Persist any newly-resolved leg durations / geocodes when we own the resolver.
  if (!travelResolver) {
    const updates = resolver.takeCacheUpdates();
    if (updates) {
      try {
        await saveSettings(userId, { ...settings, travelCache: updates });
      } catch (err) {
        // Cache writes are best-effort — never block a render if they fail.
        console.warn("buildSystemBlocks: cache flush failed", err);
      }
    }
  }

  return blocks;
}

/** Helper to extract overrides from a stored WeeklyPlan. */
export function overridesFromPlan(plan: WeeklyPlan | undefined): SystemBlocksOverrides {
  const sleep = new Map<number, { key: number; startMs: number; endMs: number }>();
  const routine = new Map<string, { key: string; startMs: number; endMs: number }>();
  if (!plan?.overrides) return { sleep, routine };
  for (const o of plan.overrides) {
    if (o.kind === "sleep") {
      const idx = Number(o.key);
      if (Number.isFinite(idx)) {
        sleep.set(idx, { key: idx, startMs: o.startMs, endMs: o.endMs });
      }
    } else if (o.kind === "routine") {
      routine.set(o.key, { key: o.key, startMs: o.startMs, endMs: o.endMs });
    }
  }
  return { sleep, routine };
}
