/**
 * Runs `allocateWeek` for the current dashboard week using the same inputs as
 * My Perfect Week (busy, system blocks, weather windows, catch-up mode). Used
 * when deriving planner `dragKey`s for syncing day-sheet logs into overrides.
 */

import { eq } from "drizzle-orm";
import {
  filterSchedulingGoals,
  type DailyReview,
  type UserSettings,
  type WeeklyPlan,
  weeklyIntentSchema
} from "@calendar-automations/schema";
import { allocateWeek, buildStableUid, type AllocateResult } from "@calendar-automations/planner";
import { db, schema } from "@/lib/db";
import { fetchGoogleBusy } from "@/lib/google-calendar";
import { isoCalendarDay, localMondayIso, localMondayMidnightMs } from "@/lib/week";
import { buildSystemBlocks, overridesFromPlan } from "@/lib/system-blocks-server";
import {
  isoDatesForWeek,
  loadDailyReviewsInRange,
  loadWeeklyReview,
  todayIsoInTz
} from "@/lib/review-store";
import {
  catchUpFloorsFromGoalRollups,
  computeGoalRollups
} from "@/lib/review-rollup";
import { computeSystemBlocks } from "@/lib/week-blocks";
import { createLegResolver } from "@/lib/routing";
import { outsideNiceWeatherIntervalsInRange } from "@/lib/nice-weather-intervals";
import { buildWeatherTimemapEvents } from "@/lib/weather-timemap";

async function loadDashboardWeeklyPlan(userId: string, timezone: string): Promise<WeeklyPlan> {
  const weekStart = localMondayIso(timezone);
  const blank = weeklyIntentSchema.parse({});
  if (!db) {
    return {
      id: "dev",
      weekStart,
      timezone,
      goals: [],
      overrides: [],
      weeklyIntent: blank
    };
  }
  const rows = await db
    .select()
    .from(schema.weeklyPlans)
    .where(eq(schema.weeklyPlans.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return {
      id: crypto.randomUUID(),
      weekStart,
      timezone,
      goals: [],
      overrides: [],
      weeklyIntent: blank
    };
  }
  const stored = row.data as Partial<WeeklyPlan>;
  return {
    ...stored,
    id: row.id,
    weekStart,
    timezone,
    goals: stored.goals ?? [],
    overrides: stored.overrides ?? [],
    weeklyIntent: weeklyIntentSchema.parse(stored.weeklyIntent ?? {})
  };
}

/**
 * Allocates the current week using `plan` as-is (caller strips `source:
 * "actual"` overrides when baseline drag keys are needed).
 */
export async function runThisWeekAllocationForPlan(
  userId: string,
  plan: WeeklyPlan,
  settings: UserSettings
): Promise<{
  allocation: AllocateResult;
  weekDates: string[];
  reviewsByDate: Map<string, DailyReview>;
} | null> {
  if (!db) return null;

  const tz = settings.timezone;
  const schedulingGoals = filterSchedulingGoals(plan.goals);
  const weekStartIso = localMondayIso(tz);
  const weeklyReview = await loadWeeklyReview(userId, weekStartIso, tz);
  const catchUpMode = settings.allocator.catchUpMode;

  const weekStartMs = localMondayMidnightMs(tz);
  const weekEndMs = weekStartMs + 7 * 24 * 60 * 60 * 1000;
  const nextWeekStartMs = weekEndMs;
  const nextWeekEndMs = nextWeekStartMs + 7 * 24 * 60 * 60 * 1000;

  const busyFetch = await fetchGoogleBusy(
    userId,
    settings.calendars.sources,
    weekStartMs,
    nextWeekEndMs
  ).catch(() => ({ busyEvents: [], goalAvailabilityWindows: {} }));

  const busyAll = busyFetch.busyEvents;
  const busy = busyAll.filter((e) => e.endMs > weekStartMs && e.startMs < weekEndMs);
  const busyNextWeek = busyAll.filter(
    (e) => e.endMs > nextWeekStartMs && e.startMs < nextWeekEndMs
  );

  const systemBlocks = await buildSystemBlocks({
    userId,
    settings,
    weekStartMs,
    busy,
    overrides: overridesFromPlan(plan)
  });
  const nextWeekResolver = createLegResolver({
    travel: settings.travel,
    cache: settings.travelCache
  });
  const nextWeekSystemBlocks = await computeSystemBlocks(
    nextWeekStartMs,
    busyNextWeek,
    settings.sleep,
    settings.travel,
    settings.gym,
    tz,
    nextWeekResolver,
    settings.timemap
  );

  const sleepBlockMs = [...systemBlocks, ...nextWeekSystemBlocks]
    .filter((b) => b.system === "sleep")
    .map((b) => ({ startMs: b.startMs, endMs: b.endMs }));

  const weatherTimemapEvents = await buildWeatherTimemapEvents({
    userId,
    windowStartMs: weekStartMs,
    windowEndMs: nextWeekEndMs,
    weather: settings.weather,
    homeAddress: settings.travel.homeAddress,
    geocodes: settings.travelCache?.geocodes,
    stableUid: buildStableUid,
    sleepBlockMs
  });
  const niceWeatherThisWeek = outsideNiceWeatherIntervalsInRange(
    weatherTimemapEvents,
    weekStartMs,
    weekEndMs
  );

  const weekDates = isoDatesForWeek(weekStartMs, tz);
  const dailyReviews = await loadDailyReviewsInRange(userId, weekDates[0]!, weekDates[weekDates.length - 1]!);
  const reviewsByDate = new Map(dailyReviews.map((r) => [r.date, r] as const));
  const todayIso = todayIsoInTz(tz);
  const todayIdx = weekDates.indexOf(todayIso);
  const dayIndex = todayIdx >= 0 ? todayIdx : 6;

  let allocation: AllocateResult;

  if (catchUpMode === "manual") {
    const resolvedCatchUpFloors = weeklyReview.catchUpAdjustments ?? {};
    allocation = allocateWeek({
      plan,
      busy: [...busy, ...systemBlocks],
      goalAvailabilityWindows: busyFetch.goalAvailabilityWindows,
      niceWeatherWindows: niceWeatherThisWeek,
      settings,
      weekStartMs,
      weekEndMs,
      catchUpFloors: resolvedCatchUpFloors,
      weekAnchorDate: plan.weekStart
    });
  } else {
    const baselineAllocation = allocateWeek({
      plan,
      busy: [...busy, ...systemBlocks],
      goalAvailabilityWindows: busyFetch.goalAvailabilityWindows,
      niceWeatherWindows: niceWeatherThisWeek,
      settings,
      weekStartMs,
      weekEndMs,
      catchUpFloors: {},
      weekAnchorDate: plan.weekStart
    });
    const effectiveTargetBaseline: Record<string, number> = {};
    for (const [id, m] of Object.entries(baselineAllocation.metrics.perGoal)) {
      effectiveTargetBaseline[id] = m.targetMinutes;
    }
    const baselineRollups = computeGoalRollups({
      goals: schedulingGoals,
      reviewsByDate,
      effectiveTargetByGoal: effectiveTargetBaseline,
      weekDates,
      dayIndex
    });
    const resolvedCatchUpFloors = catchUpFloorsFromGoalRollups(baselineRollups);
    allocation = allocateWeek({
      plan,
      busy: [...busy, ...systemBlocks],
      goalAvailabilityWindows: busyFetch.goalAvailabilityWindows,
      niceWeatherWindows: niceWeatherThisWeek,
      settings,
      weekStartMs,
      weekEndMs,
      catchUpFloors: resolvedCatchUpFloors,
      weekAnchorDate: plan.weekStart
    });
  }

  return { allocation, weekDates, reviewsByDate };
}

export { loadDashboardWeeklyPlan };
