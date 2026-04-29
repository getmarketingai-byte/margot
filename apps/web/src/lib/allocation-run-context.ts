/**
 * Shared server inputs for Perfect Week allocation, ICS regeneration, and
 * day-sheet sync — one Google fetch + weather build + catch-up resolution so
 * `allocateWeek` arguments stay aligned across surfaces.
 */

import "server-only";

import type { DailyReview, UserSettings, WeeklyPlan } from "@calendar-automations/schema";
import { filterSchedulingGoals } from "@calendar-automations/schema";
import type { BusyEvent } from "@calendar-automations/planner";
import { allocateWeek, buildStableUid, goalOverrideSourcesFromPlan } from "@calendar-automations/planner";
import { fetchGoogleBusy } from "@/lib/google-calendar";
import { isoCalendarDay, localMondayMidnightMs } from "@/lib/week";
import { buildSystemBlocks, overridesFromPlan } from "@/lib/system-blocks-server";
import { computeSystemBlocks, sleepIntervalsFromSystemBlocks } from "@/lib/week-blocks";
import { createLegResolver } from "@/lib/routing";
import { outsideNiceWeatherIntervalsInRange } from "@/lib/nice-weather-intervals";
import { buildWeatherTimemapEvents } from "@/lib/weather-timemap";
import type { GeneratedEvent } from "@calendar-automations/schema";
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
import { daySheetGoalBusyEvents } from "@/lib/day-sheet-goal-busy";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlanWeekAllocationInputs {
  nowMs: number;
  /** Google + invert-free-busy window (covers current ISO week through scheduling horizon). */
  fetchStartMs: number;
  fetchEndMs: number;
  weekStartMs: number;
  weekEndMs: number;
  nextWeekStartMs: number;
  nextWeekEndMs: number;
  snapshotEndMs: number;
  busyFetch: Awaited<ReturnType<typeof fetchGoogleBusy>>;
  busy: BusyEvent[];
  busyNextWeek: BusyEvent[];
  systemBlocks: Awaited<ReturnType<typeof buildSystemBlocks>>;
  nextWeekSystemBlocks: Awaited<ReturnType<typeof computeSystemBlocks>>;
  weatherTimemapEvents: GeneratedEvent[];
  niceWeatherThisWeek: ReturnType<typeof outsideNiceWeatherIntervalsInRange>;
  niceWeatherNextWeek: ReturnType<typeof outsideNiceWeatherIntervalsInRange>;
  catchUpFloors: Record<string, number>;
  weekDates: string[];
  reviewsByDate: Map<string, DailyReview>;
  dayIndex: number;
  nextWeekAnchor: string;
  /** Goal log slots → busy intervals for the visible ISO week (merge into real allocateWeek only). */
  daySheetGoalBusyThisWeek: BusyEvent[];
  daySheetGoalBusyNextWeek: BusyEvent[];
}

export async function loadPlanWeekAllocationInputs(options: {
  userId: string;
  plan: WeeklyPlan;
  settings: UserSettings;
  nowMs: number;
}): Promise<PlanWeekAllocationInputs> {
  const { userId, plan, settings, nowMs } = options;
  const tz = settings.timezone;
  const schedulingDays = settings.calendars.schedulingWindowDays;
  const snapshotEndMs = nowMs + schedulingDays * DAY_MS;

  const weekStartMs = localMondayMidnightMs(tz, new Date(nowMs));
  const weekEndMs = weekStartMs + 7 * DAY_MS;
  const nextWeekStartMs = weekEndMs;
  const nextWeekEndMs = nextWeekStartMs + 7 * DAY_MS;

  const fetchStartMs = Math.min(weekStartMs, nowMs);
  const fetchEndMs = Math.max(snapshotEndMs, nextWeekEndMs);

  const busyFetch = await fetchGoogleBusy(
    userId,
    settings.calendars.sources,
    fetchStartMs,
    fetchEndMs
  ).catch(() => ({ busyEvents: [] as BusyEvent[], goalAvailabilityWindows: {} }));

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
    overrides: overridesFromPlan(plan),
    nowMs
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

  const weatherWindowEnd = Math.max(fetchEndMs, nextWeekEndMs);
  const weatherTimemapEvents = await buildWeatherTimemapEvents({
    userId,
    windowStartMs: weekStartMs,
    windowEndMs: weatherWindowEnd,
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
  const niceWeatherNextWeek = outsideNiceWeatherIntervalsInRange(
    weatherTimemapEvents,
    nextWeekStartMs,
    nextWeekEndMs
  );

  const weekDates = isoDatesForWeek(weekStartMs, tz);
  const nextWeekDates = isoDatesForWeek(nextWeekStartMs, tz);
  const dailyReviews = await loadDailyReviewsInRange(
    userId,
    weekDates[0]!,
    nextWeekDates[nextWeekDates.length - 1]!
  );
  const reviewsByDate = new Map(dailyReviews.map((r) => [r.date, r] as const));
  const todayIso = todayIsoInTz(tz);
  const todayIdx = weekDates.indexOf(todayIso);
  const dayIndex = todayIdx >= 0 ? todayIdx : 6;
  const nextWeekAnchor = isoCalendarDay(nextWeekStartMs, tz);
  const schedulingGoals = filterSchedulingGoals(plan.goals);

  const weekStartIso = isoCalendarDay(weekStartMs, tz);
  const weeklyReview = await loadWeeklyReview(userId, weekStartIso, tz);
  const catchUpMode = settings.allocator.catchUpMode;

  let catchUpFloors: Record<string, number>;
  if (catchUpMode === "manual") {
    catchUpFloors = weeklyReview.catchUpAdjustments ?? {};
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
      weekAnchorDate: plan.weekStart,
      goalOverrideSources: goalOverrideSourcesFromPlan(plan),
      sleepIntervals: sleepIntervalsFromSystemBlocks(systemBlocks)
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
    catchUpFloors = catchUpFloorsFromGoalRollups(baselineRollups);
  }

  const goalTitleById = new Map(schedulingGoals.map((g) => [g.id, g.title] as const));
  const daySheetGoalBusyThisWeek = daySheetGoalBusyEvents({
    reviewsByDate,
    weekDates,
    timezone: tz,
    weekStartMs,
    weekEndMs,
    goalTitleById
  });
  const daySheetGoalBusyNextWeek = daySheetGoalBusyEvents({
    reviewsByDate,
    weekDates: nextWeekDates,
    timezone: tz,
    weekStartMs: nextWeekStartMs,
    weekEndMs: nextWeekEndMs,
    goalTitleById
  });

  return {
    nowMs,
    fetchStartMs,
    fetchEndMs,
    weekStartMs,
    weekEndMs,
    nextWeekStartMs,
    nextWeekEndMs,
    snapshotEndMs,
    busyFetch,
    busy,
    busyNextWeek,
    systemBlocks,
    nextWeekSystemBlocks,
    weatherTimemapEvents,
    niceWeatherThisWeek,
    niceWeatherNextWeek,
    catchUpFloors,
    weekDates,
    reviewsByDate,
    dayIndex,
    nextWeekAnchor,
    daySheetGoalBusyThisWeek,
    daySheetGoalBusyNextWeek
  };
}
