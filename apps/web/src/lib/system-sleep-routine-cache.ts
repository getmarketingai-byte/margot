/**
 * Persists derived sleep + morning/shutdown routine blocks per user and ISO week.
 * Travel overlays are always recomputed (resolver / APIs); sleep+routines replay
 * only when calendar busy, travel geometry, sleep window, routine minutes, and
 * overrides match the prior fingerprint.
 */

import "server-only";

import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import type { BusyEvent } from "@calendar-automations/planner";
import type { GymSettings, SleepSettings, TimemapSettings, TravelSettings } from "@calendar-automations/schema";
import { db, schema } from "@/lib/db";
import type { SystemBlock, SystemBlocksOverrides } from "./week-blocks";

export function fingerprintSleepRoutineInputs(params: {
  busy: readonly BusyEvent[];
  travelBlocks: readonly SystemBlock[];
  sleep: SleepSettings;
  timemap?: TimemapSettings;
  gym: GymSettings;
  travel: TravelSettings;
  overrides?: SystemBlocksOverrides;
  weekStartMs: number;
  timezone: string;
  driveTag: string;
}): string {
  const normalizedBusy = [...params.busy]
    .map((e) => ({
      id: e.sourceId,
      s: e.startMs,
      e: e.endMs,
      b: e.busy,
      loc: e.location ?? null,
      src: e.source ?? null,
      t: e.title ?? "",
      /** Bust cache when calendar display names appear or change on busy rows. */
      cdn: e.calendarDisplayName ?? ""
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const normalizedTravel = [...params.travelBlocks]
    .map((b) => ({
      id: b.sourceId,
      s: b.startMs,
      e: b.endMs,
      v: b.variant ?? null,
      t: b.title ?? ""
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const sleepOv = params.overrides?.sleep
    ? [...params.overrides.sleep.entries()].sort((a, b) => a[0] - b[0])
    : [];
  const routineOv = params.overrides?.routine
    ? [...params.overrides.routine.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    : [];

  const timemapRoutines = params.timemap
    ? {
        morning: params.timemap.morningRoutine,
        shutdown: params.timemap.shutdownRoutine
      }
    : null;

  const travelStructural = {
    arriveMinutesBefore: params.travel.arriveMinutesBefore,
    minHomeMinutes: params.travel.minHomeMinutes,
    fallbackDurationMinutes: params.travel.fallbackDurationMinutes,
    routingAvoidTolls: params.travel.routingAvoidTolls,
    virtualLocationSubstrings: params.travel.virtualLocationSubstrings,
    homeAddress: params.travel.homeAddress ?? "",
    gymEnabled: params.gym.enabled,
    gymTitle: params.gym.title,
    gymLocSub: params.gym.locationSubstring ?? "",
    gymDriveMin: params.gym.driveMinutes
  };

  return createHash("sha256")
    .update(
      JSON.stringify({
        busy: normalizedBusy,
        travel: normalizedTravel,
        sleep: params.sleep,
        timemapRoutines,
        travelStructural,
        sleepOv,
        routineOv,
        weekStartMs: params.weekStartMs,
        timezone: params.timezone,
        driveTag: params.driveTag
      })
    )
    .digest("hex")
    .slice(0, 56);
}

export async function trySleepRoutineCacheHit(
  userId: string,
  weekStartIso: string,
  fingerprint: string
): Promise<{ sleepBlocks: SystemBlock[]; routineBlocks: SystemBlock[] } | null> {
  if (!db) return null;
  const rows = await db
    .select()
    .from(schema.systemSleepRoutineCache)
    .where(
      and(
        eq(schema.systemSleepRoutineCache.userId, userId),
        eq(schema.systemSleepRoutineCache.weekStartIso, weekStartIso)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row || row.inputsFingerprint !== fingerprint) return null;
  return {
    sleepBlocks: row.sleepBlocks as SystemBlock[],
    routineBlocks: row.routineBlocks as SystemBlock[]
  };
}

export async function saveSleepRoutineCache(args: {
  userId: string;
  weekStartIso: string;
  fingerprint: string;
  sleepBlocks: SystemBlock[];
  routineBlocks: SystemBlock[];
}): Promise<void> {
  if (!db) return;
  await db
    .insert(schema.systemSleepRoutineCache)
    .values({
      userId: args.userId,
      weekStartIso: args.weekStartIso,
      inputsFingerprint: args.fingerprint,
      sleepBlocks: args.sleepBlocks,
      routineBlocks: args.routineBlocks,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: [schema.systemSleepRoutineCache.userId, schema.systemSleepRoutineCache.weekStartIso],
      set: {
        inputsFingerprint: args.fingerprint,
        sleepBlocks: args.sleepBlocks,
        routineBlocks: args.routineBlocks,
        updatedAt: new Date()
      }
    });
}
