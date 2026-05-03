/**
 * Shared server inputs for Perfect Week allocation, ICS regeneration, and
 * day-sheet sync — one Google fetch + weather build + catch-up resolution so
 * `allocateWeek` arguments stay aligned across surfaces.
 */

import "server-only";

import type { DailyReview, UserSettings, WeeklyPlan } from "@calendar-automations/schema";
import { filterSchedulingGoals, normaliseGoalTime } from "@calendar-automations/schema";
import type { BusyEvent } from "@calendar-automations/planner";
import {
  allocateWeek,
  baselineWeeklyMinuteTargets,
  buildStableUid,
  computeDayCalendarDrainScores,
  goalOverrideSourcesFromPlan,
  schedulingGoalsWithWeeklyRoutines
} from "@calendar-automations/planner";
import { fetchGoogleBusy } from "@/lib/google-busy-cache";
import { isoCalendarDay, localMondayMidnightMs } from "@/lib/week";
import { buildSystemBlocks, computeSystemBlocksWithSleepRoutineCache, overridesFromPlan } from "@/lib/system-blocks-server";
import { sleepIntervalsForAllocation, type SystemBlock } from "@/lib/week-blocks";
import { createLegResolver } from "@/lib/routing";
import { outsideNiceWeatherIntervalsInRange } from "@/lib/nice-weather-intervals";
import { buildWeatherTimemapEvents } from "@/lib/weather-timemap";
import type { GeneratedEvent } from "@calendar-automations/schema";
import { saveSettings } from "@/lib/settings-store";
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
import type { BillingState } from "@/lib/subscription";
import {
  DAY_MS,
  WEEK_MS,
  effectiveScheduleHorizon,
  type EffectiveScheduleHorizon
} from "@/lib/effective-schedule-horizon";

/** Per ISO week inputs aligned with {@link loadPlanWeekAllocationInputs}. */
export interface PlanWeekSlice {
  weekIndex: number;
  weekStartMs: number;
  weekEndMs: number;
  weekDates: string[];
  weekAnchorDate: string;
  busy: BusyEvent[];
  systemBlocks: SystemBlock[];
  niceWeatherWindows: ReturnType<typeof outsideNiceWeatherIntervalsInRange>;
  daySheetGoalBusy: BusyEvent[];
}

export interface PlanWeekAllocationInputs {
  billing: BillingState;
  scheduleHorizon: EffectiveScheduleHorizon;
  /** Full horizon — merged slices for callers that iterate weeks. */
  weekSlices: PlanWeekSlice[];
  nowMs: number;
  /** Google + invert-free-busy window (covers current ISO week through scheduling horizon). */
  fetchStartMs: number;
  fetchEndMs: number;
  weekStartMs: number;
  weekEndMs: number;
  /** Weeks 1.. when present — mirrors {@link weekSlices}[1]. */
  nextWeekStartMs: number;
  nextWeekEndMs: number;
  snapshotEndMs: number;
  busyFetch: Awaited<ReturnType<typeof fetchGoogleBusy>>;
  busy: BusyEvent[];
  busyNextWeek: BusyEvent[];
  systemBlocks: SystemBlock[];
  nextWeekSystemBlocks: SystemBlock[];
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
  /**
   * Mon–Sun coarse calendar load (0–1) for the visible week when personal/energy
   * UI is enabled; blends same-day daily review energy when present.
   */
  dayCalendarDrainThisWeek?: number[];
}

/** Blend logged day-sheet energy (slot-level) into the coarse calendar drain score. */
function reviewEnergyDrainBump(review: DailyReview | undefined): number {
  const slots = review?.slots;
  if (!slots?.length) return 0;
  let drain = 0;
  let energise = 0;
  for (const s of slots) {
    if (s.energy === "drain") drain++;
    if (s.energy === "energise") energise++;
  }
  if (drain > energise) return 0.06;
  if (energise > drain) return -0.04;
  return 0;
}

export async function loadPlanWeekAllocationInputs(options: {
  userId: string;
  plan: WeeklyPlan;
  settings: UserSettings;
  nowMs: number;
  billing: BillingState;
}): Promise<PlanWeekAllocationInputs> {
  const { userId, plan, settings, nowMs, billing } = options;
  const tz = settings.timezone;
  const schedulingDays = settings.calendars.schedulingWindowDays;
  const snapshotEndMs = nowMs + schedulingDays * DAY_MS;

  const weekStartMs = localMondayMidnightMs(tz, new Date(nowMs));
  const weekEndMs = weekStartMs + WEEK_MS;

  const scheduleHorizon = effectiveScheduleHorizon({
    billing,
    storedScheduleHorizonWeeks: settings.calendars.scheduleHorizonWeeks,
    nowMs,
    baseWeekStartMs: weekStartMs
  });

  const allocationSpanEndMs = weekStartMs + scheduleHorizon.isoWeekCount * WEEK_MS;

  const fetchStartMs = Math.min(weekStartMs, nowMs);
  const fetchEndMs = Math.max(snapshotEndMs, allocationSpanEndMs);

  const busyFetch = await fetchGoogleBusy(
    userId,
    settings.calendars.sources,
    fetchStartMs,
    fetchEndMs
  ).catch(() => ({ busyEvents: [] as BusyEvent[], goalAvailabilityWindows: {} }));

  const busyAll = busyFetch.busyEvents;

  const travelResolver = createLegResolver({
    travel: settings.travel,
    cache: settings.travelCache
  });

  type SliceDraft = {
    weekIndex: number;
    weekStartMs: number;
    weekEndMs: number;
    busy: BusyEvent[];
    systemBlocks: SystemBlock[];
    weekDates: string[];
    weekAnchorDate: string;
  };

  const drafts: SliceDraft[] = [];

  for (let w = 0; w < scheduleHorizon.isoWeekCount; w++) {
    const ws = weekStartMs + w * WEEK_MS;
    const we = ws + WEEK_MS;
    const busyW = busyAll.filter((e) => e.endMs > ws && e.startMs < we);

    let systemW: SystemBlock[];
    if (w === 0) {
      systemW = await buildSystemBlocks({
        userId,
        settings,
        weekStartMs: ws,
        busy: busyW,
        overrides: overridesFromPlan(plan),
        nowMs,
        travelResolver
      });
    } else {
      systemW = await computeSystemBlocksWithSleepRoutineCache({
        userId,
        weekStartMs: ws,
        busy: busyW,
        sleep: settings.sleep,
        travel: settings.travel,
        gym: settings.gym,
        timezone: tz,
        resolver: travelResolver,
        timemap: settings.timemap,
        overrides: {},
        nowMs
      });
    }

    const weekDates = isoDatesForWeek(ws, tz);
    drafts.push({
      weekIndex: w,
      weekStartMs: ws,
      weekEndMs: we,
      busy: busyW,
      systemBlocks: systemW,
      weekDates,
      weekAnchorDate: isoCalendarDay(ws, tz)
    });
  }

  const travelCacheUpdates = travelResolver.takeCacheUpdates();
  if (travelCacheUpdates) {
    try {
      await saveSettings(userId, { ...settings, travelCache: travelCacheUpdates });
    } catch (err) {
      console.warn("loadPlanWeekAllocationInputs: travel cache flush failed", err);
    }
  }

  const allSystemBlocks = drafts.flatMap((d) => d.systemBlocks);
  const busyForSleep = busyAll.filter(
    (e) => e.endMs > weekStartMs && e.startMs < allocationSpanEndMs
  );

  const sleepBlockMs = sleepIntervalsForAllocation(allSystemBlocks, busyForSleep);

  const weatherWindowEnd = Math.max(fetchEndMs, allocationSpanEndMs);
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

  const reviewStartIso = drafts[0]!.weekDates[0]!;
  const reviewEndIso = drafts[drafts.length - 1]!.weekDates[6]!;
  const dailyReviews = await loadDailyReviewsInRange(userId, reviewStartIso, reviewEndIso);
  const reviewsByDate = new Map(dailyReviews.map((r) => [r.date, r] as const));
  const todayIso = todayIsoInTz(tz);
  const todayIdx = drafts[0]!.weekDates.indexOf(todayIso);
  const dayIndex = todayIdx >= 0 ? todayIdx : 6;

  const schedulingGoals = schedulingGoalsWithWeeklyRoutines(plan.goals, settings);
  const goalTitleById = new Map(schedulingGoals.map((g) => [g.id, g.title] as const));

  const weekSlices: PlanWeekSlice[] = drafts.map((d) => ({
    ...d,
    niceWeatherWindows: outsideNiceWeatherIntervalsInRange(
      weatherTimemapEvents,
      d.weekStartMs,
      d.weekEndMs
    ),
    daySheetGoalBusy: daySheetGoalBusyEvents({
      reviewsByDate,
      weekDates: d.weekDates,
      timezone: tz,
      weekStartMs: d.weekStartMs,
      weekEndMs: d.weekEndMs,
      goalTitleById
    })
  }));

  const slice0 = weekSlices[0]!;
  const slice1 = weekSlices[1];

  const busy = slice0.busy;
  const busyNextWeek = slice1?.busy ?? [];
  const systemBlocks = slice0.systemBlocks;
  const nextWeekSystemBlocks = slice1?.systemBlocks ?? [];
  const niceWeatherThisWeek = slice0.niceWeatherWindows;
  const niceWeatherNextWeek = slice1?.niceWeatherWindows ?? [];
  const weekDates = slice0.weekDates;
  const nextWeekStartMs = slice1?.weekStartMs ?? weekEndMs;
  const nextWeekEndMs = slice1?.weekEndMs ?? weekEndMs + WEEK_MS;
  const nextWeekAnchor = slice1?.weekAnchorDate ?? isoCalendarDay(nextWeekStartMs, tz);
  const daySheetGoalBusyThisWeek = slice0.daySheetGoalBusy;
  const daySheetGoalBusyNextWeek = slice1?.daySheetGoalBusy ?? [];

  const userSchedulingGoalsNoRoutines = filterSchedulingGoals(plan.goals).filter(
    (g) => g.specialGoalType !== "gym"
  );

  const weekStartIso = isoCalendarDay(weekStartMs, tz);
  const weeklyReview = await loadWeeklyReview(userId, weekStartIso, tz);
  const catchUpMode = settings.allocator.catchUpMode;

  let catchUpFloors: Record<string, number>;
  if (catchUpMode === "manual") {
    catchUpFloors = weeklyReview.catchUpAdjustments ?? {};
  } else {
    const effectiveTargetBaseline = baselineWeeklyMinuteTargets({
      plan,
      busy: [...busy, ...systemBlocks],
      goalAvailabilityWindows: busyFetch.goalAvailabilityWindows,
      niceWeatherWindows: niceWeatherThisWeek,
      settings,
      weekStartMs,
      weekEndMs,
      weekAnchorDate: plan.weekStart,
      goalOverrideSources: goalOverrideSourcesFromPlan(plan),
      sleepIntervals: sleepIntervalsForAllocation(systemBlocks, busy)
    });
    const baselineRollups = computeGoalRollups({
      goals: schedulingGoals,
      reviewsByDate,
      effectiveTargetByGoal: effectiveTargetBaseline,
      weekDates,
      dayIndex
    });
    catchUpFloors = catchUpFloorsFromGoalRollups(baselineRollups);
    const allGoalsUnconstrained = userSchedulingGoalsNoRoutines.every((g) => {
      const norm = normaliseGoalTime(g);
      const onlyDailyMinimum =
        norm.minMinutesPerDay !== undefined &&
        norm.maxMinutesPerDay === undefined &&
        norm.minMinutesPerWeek === undefined &&
        norm.maxMinutesPerWeek === undefined &&
        g.frequencyPerWeek === undefined &&
        g.allocationSharePercent === undefined;
      return (
        (norm.isEqualShare || onlyDailyMinimum) &&
        g.dayOfWeek === undefined &&
        (g.daysOfWeek?.length ?? 0) === 0 &&
        g.earliestHour === undefined &&
        g.latestHour === undefined &&
        g.scheduleInNiceWeather !== true &&
        !(g.placementIdealClockTimes && g.placementIdealClockTimes.length > 0)
      );
    });
    if (allGoalsUnconstrained) catchUpFloors = {};
  }

  const showEnergyPreview =
    settings.personalSystem.enabled || settings.personalSystem.energyBatterySchedulingEnabled;
  const dayWindows = Array.from({ length: 7 }, (_, i) => ({
    startMs: weekStartMs + i * DAY_MS,
    endMs: weekStartMs + (i + 1) * DAY_MS
  }));
  let dayCalendarDrainThisWeek: number[] | undefined;
  if (showEnergyPreview) {
    const raw = computeDayCalendarDrainScores(
      [...busy, ...daySheetGoalBusyThisWeek, ...systemBlocks],
      dayWindows
    );
    dayCalendarDrainThisWeek = raw.map((d, i) => {
      const iso = weekDates[i];
      const r = iso ? reviewsByDate.get(iso) : undefined;
      const bump = reviewEnergyDrainBump(r);
      return Math.max(0, Math.min(1, d + bump));
    });
  }

  return {
    billing,
    scheduleHorizon,
    weekSlices,
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
    daySheetGoalBusyNextWeek,
    dayCalendarDrainThisWeek
  };
}
