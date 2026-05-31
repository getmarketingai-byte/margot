/**
 * Persists the latest Google Calendar busy projection per user so dashboard
 * reads can return immediately from Postgres while refresh runs in the
 * background (Next `after`) or on a cron-driven Inngest fan-out.
 */

import "server-only";

import { createHash } from "crypto";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import type { BusyEvent, Interval } from "@margot/planner";
import { normaliseCalendarSource, type CalendarSource } from "@margot/schema";
import {
  invalidateUserAllocationCache,
  scheduleInvalidateUserAllocationCache
} from "@/lib/allocation-cache-invalidation";
import { db, schema } from "@/lib/db";
import {
  fetchGoogleBusyLive,
  GoogleReauthRequiredError,
  googleReauthSignInPath
} from "@/lib/google-calendar";
import { googleBusyFetchWindowForPlanner } from "@/lib/google-busy-fetch-window";
import { loadBillingState } from "@/lib/billing-state-server";
import { loadSettings } from "@/lib/settings-store";

/**
 * Minimum cache age before each dashboard read enqueues a quiet Google refresh
 * (`after`). Cached rows are always returned immediately when the window matches.
 */
const GOOGLE_BUSY_BACKGROUND_REFRESH_AFTER_MS = 20 * 60 * 1000;

function payloadFromGoogleBusyRow(row: typeof schema.googleBusyCache.$inferSelect): {
  busyEvents: BusyEvent[];
  goalAvailabilityWindows: Record<string, Interval[]>;
} {
  return {
    busyEvents: row.busyEvents as BusyEvent[],
    goalAvailabilityWindows: row.goalAvailabilityWindows as Record<string, Interval[]>
  };
}

export function fingerprintGoogleCalendarSources(sources: readonly CalendarSource[]): string {
  const normalized = sources
    .map((s) => normaliseCalendarSource(s))
    .filter((s) => s.provider === "google")
    .sort((a, b) => a.externalId.localeCompare(b.externalId));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 48);
}

async function upsertGoogleBusyCacheRow(options: {
  userId: string;
  sourcesFingerprint: string;
  windowStartMs: number;
  windowEndMs: number;
  payload: { busyEvents: BusyEvent[]; goalAvailabilityWindows: Record<string, Interval[]> };
}): Promise<void> {
  if (!db) return;
  const { userId, sourcesFingerprint, windowStartMs, windowEndMs, payload } = options;
  await db
    .insert(schema.googleBusyCache)
    .values({
      userId,
      updatedAt: new Date(),
      windowStartMs: String(windowStartMs),
      windowEndMs: String(windowEndMs),
      sourcesFingerprint,
      busyEvents: payload.busyEvents,
      goalAvailabilityWindows: payload.goalAvailabilityWindows
    })
    .onConflictDoUpdate({
      target: schema.googleBusyCache.userId,
      set: {
        updatedAt: new Date(),
        windowStartMs: String(windowStartMs),
        windowEndMs: String(windowEndMs),
        sourcesFingerprint,
        busyEvents: payload.busyEvents,
        goalAvailabilityWindows: payload.goalAvailabilityWindows
      }
    });
}

/**
 * Refetches the planner-wide busy window and upserts the cache row. Safe for
 * Inngest/cron; bumps allocation cache tags when data changes on disk.
 */
export async function refreshGoogleBusyCacheForUser(userId: string): Promise<void> {
  if (!db) return;
  const settings = await loadSettings(userId);
  const billing = await loadBillingState(userId);
  const nowMs = Date.now();
  const { fetchStartMs, fetchEndMs } = googleBusyFetchWindowForPlanner(settings, nowMs, billing);
  const fp = fingerprintGoogleCalendarSources(settings.calendars.sources);
  let live: Awaited<ReturnType<typeof fetchGoogleBusyLive>>;
  try {
    live = await fetchGoogleBusyLive(
      userId,
      settings.calendars.sources,
      fetchStartMs,
      fetchEndMs
    );
  } catch (err) {
    if (err instanceof GoogleReauthRequiredError) {
      console.warn("[google-busy-cache] Google reauth required; skipping cache refresh", { userId });
      return;
    }
    throw err;
  }
  await upsertGoogleBusyCacheRow({
    userId,
    sourcesFingerprint: fp,
    windowStartMs: fetchStartMs,
    windowEndMs: fetchEndMs,
    payload: live
  });
  invalidateUserAllocationCache(userId);
}

function scheduleQuietGoogleBusyRefresh(userId: string): void {
  after(async () => {
    try {
      await refreshGoogleBusyCacheForUser(userId);
    } catch (err) {
      console.error("[google-busy-cache] background refresh failed", err);
    }
  });
}

/**
 * Read path used by allocation and review surfaces. Uses Postgres when `db` is
 * configured; otherwise falls through to a live Google fetch every time.
 */
export async function fetchGoogleBusy(
  userId: string,
  sources: readonly CalendarSource[],
  windowStartMs: number,
  windowEndMs: number,
  options?: { oauthReturnPath?: string }
): Promise<{ busyEvents: BusyEvent[]; goalAvailabilityWindows: Record<string, Interval[]> }> {
  const oauthReturnPath = options?.oauthReturnPath ?? "/dashboard";

  if (!db) {
    try {
      return await fetchGoogleBusyLive(userId, sources, windowStartMs, windowEndMs, {
        oauthReturnPath
      });
    } catch (err) {
      if (err instanceof GoogleReauthRequiredError) {
        redirect(googleReauthSignInPath(err.returnPath));
      }
      console.warn("[google-busy-cache] live fetch failed (no DATABASE_URL cache)", err);
      return { busyEvents: [], goalAvailabilityWindows: {} };
    }
  }

  const fp = fingerprintGoogleCalendarSources(sources);
  const rows = await db
    .select()
    .from(schema.googleBusyCache)
    .where(eq(schema.googleBusyCache.userId, userId))
    .limit(1);
  const row = rows[0];
  const now = Date.now();

  const coversWindow =
    row &&
    row.sourcesFingerprint === fp &&
    Number(row.windowStartMs) <= windowStartMs &&
    Number(row.windowEndMs) >= windowEndMs;

  const rowAgeMs = row ? now - row.updatedAt.getTime() : Infinity;

  if (coversWindow) {
    if (rowAgeMs >= GOOGLE_BUSY_BACKGROUND_REFRESH_AFTER_MS) {
      scheduleQuietGoogleBusyRefresh(userId);
    }
    return payloadFromGoogleBusyRow(row);
  }

  const settings = await loadSettings(userId);
  const billing = await loadBillingState(userId);
  const { fetchStartMs, fetchEndMs } = googleBusyFetchWindowForPlanner(settings, now, billing);

  try {
    const live = await fetchGoogleBusyLive(userId, sources, fetchStartMs, fetchEndMs, {
      oauthReturnPath
    });
    await upsertGoogleBusyCacheRow({
      userId,
      sourcesFingerprint: fp,
      windowStartMs: fetchStartMs,
      windowEndMs: fetchEndMs,
      payload: live
    });
    scheduleInvalidateUserAllocationCache(userId);
    return live;
  } catch (err) {
    if (err instanceof GoogleReauthRequiredError) {
      redirect(googleReauthSignInPath(err.returnPath));
    }
    const staleMatchesSources = row && row.sourcesFingerprint === fp;
    if (staleMatchesSources) {
      console.warn(
        "[google-busy-cache] live Google Calendar fetch failed; using last Postgres snapshot (may not cover the full planner window)",
        err
      );
      return payloadFromGoogleBusyRow(row);
    }
    console.error("[google-busy-cache] live fetch failed and no matching cached row", err);
    throw err;
  }
}
