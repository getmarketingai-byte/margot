/**
 * Day sheet page.
 *
 * Loads (or creates a fresh) daily review row for `?date=YYYY-MM-DD`,
 * defaulting to today in the user's timezone. The first time a date is
 * opened we run the allocator to snapshot that day's planned blocks into
 * the row so block marks have a stable reference.
 */

import { eq } from "drizzle-orm";
import Link from "next/link";
import {
  filterSchedulingGoals,
  type AllocatedBlockSnapshot,
  type WeeklyPlan
} from "@calendar-automations/schema";
import { allocateWeek, buildStableUid, goalOverrideSourcesFromPlan } from "@calendar-automations/planner";
import { authOrPreview } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { loadSettings } from "@/lib/settings-store";
import { fetchGoogleBusy } from "@/lib/google-calendar";
import {
  localMidnightMs,
  localMondayIso,
  localMondayMidnightMs,
  partsInTimezone
} from "@/lib/week";
import {
  isoDatesForWeek,
  isoDateInTz,
  loadDailyReview,
  loadDailyReviewsInRange,
  loadWeeklyReview,
  saveDailyReview,
  todayIsoInTz
} from "@/lib/review-store";
import {
  catchUpFloorsFromGoalRollups,
  computeGoalRollups
} from "@/lib/review-rollup";
import { outsideNiceWeatherIntervalsInRange } from "@/lib/nice-weather-intervals";
import { buildSystemBlocks, overridesFromPlan } from "@/lib/system-blocks-server";
import { sleepIntervalsFromSystemBlocks } from "@/lib/week-blocks";
import { buildWeatherTimemapEvents } from "@/lib/weather-timemap";
import { DailyReviewClient } from "./daily-review-client";
import { ReviewDatePicker } from "./date-picker";

export const dynamic = "force-dynamic";

interface ReviewPageProps {
  searchParams: Promise<{ date?: string }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  if (!row) {
    return { ...empty, id: crypto.randomUUID() };
  }
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

function shiftIsoDate(date: string, deltaDays: number, timezone: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const baseMs = localMidnightMs(y, m, d, timezone);
  return isoDateInTz(baseMs + deltaDays * DAY_MS, timezone);
}

function prettyDateLabel(ms: number, timezone: string): string {
  const fmt = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  return fmt.format(new Date(ms));
}

function dayOfWeekLabel(ms: number, timezone: string): string {
  const fmt = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    weekday: "long"
  });
  return fmt.format(new Date(ms));
}

export default async function ReviewPage({ searchParams }: ReviewPageProps) {
  const session = await authOrPreview();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);
  const tz = settings.timezone;

  const params = await searchParams;
  const requestedDate = params?.date;
  const date =
    requestedDate && ISO_DATE_RE.test(requestedDate)
      ? requestedDate
      : todayIsoInTz(tz);

  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const dayStartMs = localMidnightMs(year, month, day, tz);
  const dayEndMs = dayStartMs + DAY_MS;

  const plan = await loadPlan(userId, tz);
  const review = await loadDailyReview(userId, date, tz);

  // Snapshot the day's planned blocks the first time the user opens this
  // date. This freezes the data block marks reference so re-allocations
  // don't orphan their keys.
  if (review.plannedBlocksSnapshot.length === 0 && plan.goals.length > 0) {
    const weekStartMs = localMondayMidnightMs(tz);
    const weekEndMs = weekStartMs + 7 * DAY_MS;
    const sameWeek = dayStartMs >= weekStartMs && dayEndMs <= weekEndMs;
    if (sameWeek) {
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
      const sleepBlockMs = systemBlocks
        .filter((b) => b.system === "sleep")
        .map((b) => ({ startMs: b.startMs, endMs: b.endMs }));
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
      const weeklyReview = await loadWeeklyReview(
        userId,
        localMondayIso(tz),
        tz
      );
      const catchUpMode = settings.allocator.catchUpMode;
      let allocation;
      if (catchUpMode === "manual") {
        allocation = allocateWeek({
          plan,
          busy: [...busy, ...systemBlocks],
          goalAvailabilityWindows: busyFetch.goalAvailabilityWindows,
          niceWeatherWindows,
          settings,
          weekStartMs,
          weekEndMs,
          catchUpFloors: weeklyReview.catchUpAdjustments ?? {},
          weekAnchorDate: localMondayIso(tz),
          goalOverrideSources: goalOverrideSourcesFromPlan(plan),
          sleepIntervals: sleepIntervalsFromSystemBlocks(systemBlocks)
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
          weekAnchorDate: localMondayIso(tz),
          goalOverrideSources: goalOverrideSourcesFromPlan(plan),
          sleepIntervals: sleepIntervalsFromSystemBlocks(systemBlocks)
        });
        const weekDates = isoDatesForWeek(weekStartMs, tz);
        const dailyReviewsRange = await loadDailyReviewsInRange(
          userId,
          weekDates[0]!,
          weekDates[weekDates.length - 1]!
        );
        const reviewsByDate = new Map(
          dailyReviewsRange.map((r) => [r.date, r] as const)
        );
        const effectiveTargetBaseline: Record<string, number> = {};
        for (const [id, m] of Object.entries(baselineAllocation.metrics.perGoal)) {
          effectiveTargetBaseline[id] = m.targetMinutes;
        }
        const schedulingGoals = filterSchedulingGoals(plan.goals);
        const todayIsoSnap = todayIsoInTz(tz);
        const todayIdxSnap = weekDates.indexOf(todayIsoSnap);
        const dayIndexSnap = todayIdxSnap >= 0 ? todayIdxSnap : 6;
        const baselineRollups = computeGoalRollups({
          goals: schedulingGoals,
          reviewsByDate,
          effectiveTargetByGoal: effectiveTargetBaseline,
          weekDates,
          dayIndex: dayIndexSnap
        });
        const catchUpFloors = catchUpFloorsFromGoalRollups(baselineRollups);
        allocation = allocateWeek({
          plan,
          busy: [...busy, ...systemBlocks],
          goalAvailabilityWindows: busyFetch.goalAvailabilityWindows,
          niceWeatherWindows,
          settings,
          weekStartMs,
          weekEndMs,
          catchUpFloors,
          weekAnchorDate: localMondayIso(tz),
          goalOverrideSources: goalOverrideSourcesFromPlan(plan),
          sleepIntervals: sleepIntervalsFromSystemBlocks(systemBlocks)
        });
      }
      const todaysBlocks: AllocatedBlockSnapshot[] = allocation.blocks
        .filter(
          (b) =>
            !b.segment && b.startMs >= dayStartMs && b.endMs <= dayEndMs
        )
        .map((b) => ({
          goalId: b.goalId,
          title: b.title,
          startMs: b.startMs,
          endMs: b.endMs,
          ...(b.dragKey ? { dragKey: b.dragKey } : {})
        }));
      if (todaysBlocks.length > 0) {
        review.plannedBlocksSnapshot = todaysBlocks;
        await saveDailyReview(userId, review);
      }
    }
  }

  const todayDate = todayIsoInTz(tz);
  const prevDate = shiftIsoDate(date, -1, tz);
  const nextDate = shiftIsoDate(date, 1, tz);
  const prettyLabel = prettyDateLabel(dayStartMs, tz);
  const dayLabel = dayOfWeekLabel(dayStartMs, tz);

  // Trim the visible log range to the user's settings if available; otherwise
  // default to a generous 06:00 → 22:00 day. The user can still tag any slot
  // by clicking inside the row.
  const logStartMinute = 6 * 60;
  const logEndMinute = 22 * 60;

  // Day index 0=Mon..6=Sun for navigation breadcrumbs.
  const dayParts = partsInTimezone(dayStartMs, tz);
  void dayParts;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">Day sheet</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          Daily check-in for energy, goals, and execution. The week review rolls
          up across days and powers the catch-up planner.
        </p>
        <div className="mt-2 text-xs">
          <Link
            href="/dashboard/week-review"
            className="text-accent hover:underline"
          >
            Week review →
          </Link>
        </div>
      </header>

      <ReviewDatePicker
        date={date}
        todayDate={todayDate}
        prevDate={prevDate}
        nextDate={nextDate}
        prettyLabel={prettyLabel}
      />

      <DailyReviewClient
        date={date}
        initialReview={review}
        goals={plan.goals}
        dayLabel={dayLabel}
        dayStartMs={dayStartMs}
        logStartMinute={logStartMinute}
        logEndMinute={logEndMinute}
      />
    </div>
  );
}
