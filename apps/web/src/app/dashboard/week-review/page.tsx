/**
 * Week review page.
 *
 * Loads the week's daily reviews, runs the allocator to derive per-goal
 * targets, and feeds both into `computeGoalRollups` for the pace board and
 * catch-up planner. The Burchard weekly questions are persisted on the
 * `weekly_review` row.
 */

import { eq } from "drizzle-orm";
import Link from "next/link";
import { filterSchedulingGoals, type WeeklyPlan } from "@calendar-automations/schema";
import { allocateWeek, buildStableUid, goalOverrideSourcesFromPlan } from "@calendar-automations/planner";
import { authOrPreview } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { loadSettings } from "@/lib/settings-store";
import { fetchGoogleBusy } from "@/lib/google-calendar";
import {
  localMondayIso,
  localMondayMidnightMs,
  partsInTimezone
} from "@/lib/week";
import {
  isoDatesForWeek,
  loadDailyReviewsInRange,
  loadWeeklyReview,
  todayIsoInTz
} from "@/lib/review-store";
import {
  catchUpFloorsFromGoalRollups,
  computeEnergyTotals,
  computeGoalRollups,
  topDrainCandidates
} from "@/lib/review-rollup";
import { outsideNiceWeatherIntervalsInRange } from "@/lib/nice-weather-intervals";
import { buildSystemBlocks, overridesFromPlan } from "@/lib/system-blocks-server";
import { sleepIntervalsForAllocation } from "@/lib/week-blocks";
import { buildWeatherTimemapEvents } from "@/lib/weather-timemap";
import { WeeklyReviewClient } from "./weekly-review-client";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

async function loadPlan(userId: string, timezone: string): Promise<WeeklyPlan> {
  const weekStart = localMondayIso(timezone);
  const empty: WeeklyPlan = {
    id: "dev",
    weekStart,
    timezone,
    goals: [],
    overrides: [],
    weeklyIntent: { hp6Focus: [] }
  };
  if (!db) return empty;
  const rows = await db
    .select()
    .from(schema.weeklyPlans)
    .where(eq(schema.weeklyPlans.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return { ...empty, id: crypto.randomUUID() };
  const stored = row.data as WeeklyPlan;
  return {
    ...stored,
    id: row.id,
    weekStart,
    timezone,
    overrides: stored.overrides ?? [],
    weeklyIntent: stored.weeklyIntent ?? { hp6Focus: [] }
  };
}

export default async function WeekReviewPage() {
  const session = await authOrPreview();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);
  const tz = settings.timezone;
  const weekStart = localMondayIso(tz);
  const weekStartMs = localMondayMidnightMs(tz);
  const weekEndMs = weekStartMs + 7 * DAY_MS;

  const plan = await loadPlan(userId, tz);
  const weeklyReview = await loadWeeklyReview(userId, weekStart, tz);
  const weekDates = isoDatesForWeek(weekStartMs, tz);
  const dailyReviews = await loadDailyReviewsInRange(
    userId,
    weekDates[0]!,
    weekDates[weekDates.length - 1]!
  );
  const reviewsByDate = new Map(dailyReviews.map((r) => [r.date, r] as const));

  // Pull busy + system blocks so the allocator's per-goal targets reflect
  // the same slot pool the Perfect Week page sees.
  const busyFetch = await fetchGoogleBusy(
    userId,
    settings.calendars.sources,
    weekStartMs,
    weekEndMs
  ).catch(() => ({ busyEvents: [], goalAvailabilityWindows: {} }));
  const busy = busyFetch.busyEvents.filter(
    (e) => e.endMs > weekStartMs && e.startMs < weekEndMs
  );
  const systemBlocks = await buildSystemBlocks({
    userId,
    settings,
    weekStartMs,
    busy,
    overrides: overridesFromPlan(plan)
  });
  const sleepBlockMs = sleepIntervalsForAllocation(systemBlocks, busy);
  const weatherTimemapEvents = await buildWeatherTimemapEvents({
    userId,
    windowStartMs: weekStartMs,
    windowEndMs: weekEndMs,
    weather: settings.weather,
    homeAddress: settings.travel.homeAddress,
    geocodes: settings.travelCache?.geocodes,
    stableUid: buildStableUid,
    sleepBlockMs
  });
  const niceWeatherWindows = outsideNiceWeatherIntervalsInRange(
    weatherTimemapEvents,
    weekStartMs,
    weekEndMs
  );
  const catchUpMode = settings.allocator.catchUpMode;
  const schedulingGoals = filterSchedulingGoals(plan.goals);
  const todayIso = todayIsoInTz(tz);
  const todayIdx = weekDates.indexOf(todayIso);
  const dayIndex = todayIdx >= 0 ? todayIdx : 6;

  let allocation;
  let resolvedAllocatorCatchUpFloors: Record<string, number>;

  if (catchUpMode === "manual") {
    resolvedAllocatorCatchUpFloors = weeklyReview.catchUpAdjustments ?? {};
    allocation = allocateWeek({
      plan,
      busy: [...busy, ...systemBlocks],
      goalAvailabilityWindows: busyFetch.goalAvailabilityWindows,
      niceWeatherWindows,
      settings,
      weekStartMs,
      weekEndMs,
      catchUpFloors: resolvedAllocatorCatchUpFloors,
      weekAnchorDate: weekStart,
      goalOverrideSources: goalOverrideSourcesFromPlan(plan),
      sleepIntervals: sleepIntervalsForAllocation(systemBlocks, busy)
    });
  } else {
    const baselineAllocation = allocateWeek({
      plan,
      busy: [...busy, ...systemBlocks],
      goalAvailabilityWindows: busyFetch.goalAvailabilityWindows,
      niceWeatherWindows,
      settings,
      weekStartMs,
      weekEndMs,
      catchUpFloors: {},
      weekAnchorDate: weekStart,
      goalOverrideSources: goalOverrideSourcesFromPlan(plan),
      sleepIntervals: sleepIntervalsForAllocation(systemBlocks, busy)
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
    resolvedAllocatorCatchUpFloors = catchUpFloorsFromGoalRollups(baselineRollups);
    allocation = allocateWeek({
      plan,
      busy: [...busy, ...systemBlocks],
      goalAvailabilityWindows: busyFetch.goalAvailabilityWindows,
      niceWeatherWindows,
      settings,
      weekStartMs,
      weekEndMs,
      catchUpFloors: resolvedAllocatorCatchUpFloors,
      weekAnchorDate: weekStart,
      goalOverrideSources: goalOverrideSourcesFromPlan(plan),
      sleepIntervals: sleepIntervalsForAllocation(systemBlocks, busy)
    });
  }

  const effectiveTargetByGoal: Record<string, number> = {};
  for (const [id, m] of Object.entries(allocation.metrics.perGoal)) {
    effectiveTargetByGoal[id] = m.targetMinutes;
  }

  const rollups = computeGoalRollups({
    goals: schedulingGoals,
    reviewsByDate,
    effectiveTargetByGoal,
    weekDates,
    dayIndex
  });

  const energyTotals = computeEnergyTotals(dailyReviews);
  const goalLabels = new Map(plan.goals.map((g) => [g.id, g.title] as const));
  const drainCandidates = topDrainCandidates(dailyReviews, goalLabels, 3);

  // Build daily highlight excerpts so the synthesis prompts have raw material
  // to draw from. Wins / improvements / focus statements pulled in date order.
  const wins: Array<{ date: string; text: string }> = [];
  const improvements: Array<{ date: string; text: string }> = [];
  const intentions: Array<{ date: string; text: string }> = [];
  for (const date of weekDates) {
    const review = reviewsByDate.get(date);
    if (!review) continue;
    const shortDate = prettyShort(date, tz);
    for (const w of review.evening?.wins ?? []) {
      if (w.trim()) wins.push({ date: shortDate, text: w });
    }
    for (const i of review.evening?.improvements ?? []) {
      if (i.trim()) improvements.push({ date: shortDate, text: i });
    }
    for (const i of review.morning?.intentions ?? []) {
      if (i.trim()) intentions.push({ date: shortDate, text: i });
    }
  }

  const prettyWeek = formatWeekRange(weekStartMs, tz);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">Week review</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          Week of {prettyWeek}. See where you&apos;re behind, set catch-up
          minutes, and answer Burchard&apos;s weekly review prompts.
        </p>
        <div className="mt-2 text-xs">
          <Link href="/dashboard/review" className="text-accent hover:underline">
            ← Day sheet
          </Link>
        </div>
      </header>

      <WeeklyReviewClient
        weekStart={weekStart}
        weekDates={weekDates}
        initialReview={weeklyReview}
        rollups={rollups}
        goals={plan.goals}
        energyTotals={energyTotals}
        drainCandidates={drainCandidates}
        dailyHighlights={{ wins, improvements, intentions }}
        catchUpMode={catchUpMode}
        allocatorCatchUpFloors={resolvedAllocatorCatchUpFloors}
      />
    </div>
  );
}

function prettyShort(isoDate: string, timezone: string): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  // Build a date by reading parts back in the tz so it formats consistently.
  const ms = Date.UTC(y, m - 1, d);
  const fmt = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short"
  });
  return fmt.format(new Date(ms));
}

function formatWeekRange(weekStartMs: number, tz: string): string {
  const startParts = partsInTimezone(weekStartMs, tz);
  const endParts = partsInTimezone(weekStartMs + 6 * DAY_MS, tz);
  const fmt = new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    day: "numeric",
    month: "short"
  });
  return `${fmt.format(new Date(weekStartMs))} – ${fmt.format(
    new Date(weekStartMs + 6 * DAY_MS)
  )} ${endParts.year !== startParts.year ? endParts.year : ""}`.trim();
}
