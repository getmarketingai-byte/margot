/**
 * Drops server-side caches that can hide stale weather, sleep geometry, or
 * travel durations until the next allocator pass. Used by the manual
 * “full refresh” pipeline after Google busy is updated.
 */

import "server-only";

import { eq } from "drizzle-orm";
import { invalidateUserAllocationCache } from "@/lib/allocation-cache-invalidation";
import { db, schema } from "@/lib/db";
import { loadSettings, saveSettings } from "@/lib/settings-store";

export async function clearScheduleAuxiliaryCaches(userId: string): Promise<void> {
  if (db) {
    await db.delete(schema.weatherForecastCache).where(eq(schema.weatherForecastCache.userId, userId));
    await db.delete(schema.systemSleepRoutineCache).where(eq(schema.systemSleepRoutineCache.userId, userId));
  }
  const settings = await loadSettings(userId);
  await saveSettings(userId, {
    ...settings,
    travelCache: {
      ...settings.travelCache,
      legs: {}
    }
  });
  invalidateUserAllocationCache(userId);
}
