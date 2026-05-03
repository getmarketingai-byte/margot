import { eq } from "drizzle-orm";
import Link from "next/link";
import { filterSchedulingGoals, type WeeklyPlan, weeklyIntentSchema, weeklyPlanSchema } from "@calendar-automations/schema";
import {
  allocateWeek,
  buildStableUid,
  goalOverrideSourcesFromPlan,
  schedulingGoalsWithWeeklyRoutines
} from "@calendar-automations/planner";
import { authOrPreview } from "@/lib/auth";
import {
  getCachedPlanWeekAllocationInputs
} from "@/lib/cached-plan-week-allocation-inputs";
import { db, schema } from "@/lib/db";
import { loadSettings } from "@/lib/settings-store";
import { localMondayIso } from "@/lib/week";
import { gymGoalTravelBlocksFromProposed, sleepIntervalsForAllocation } from "@/lib/week-blocks";
import { computeGoalRollups } from "@/lib/review-rollup";
import { filterInvertedTimemapFromProposedBlocks } from "@/lib/proposed-calendar-filter";
import { mergeOrphanGoalOverrideBlocks } from "@/lib/merge-orphan-goal-override-blocks";
import { invertedCalendarTimemapEvents } from "@/lib/inverted-timemap-ics-events";
import { loadBillingState } from "@/lib/billing-state-server";
import { clipIntervalBlocksToHorizon } from "@/lib/effective-schedule-horizon";
import { goalIdsReferencedInDaySheetSlotsFromReviews } from "@/lib/purge-goal-from-reviews";
import { loadAllDailyReviewsForUser } from "@/lib/review-store";
import { processExpiredWeeklyPlanTrash } from "@/lib/weekly-plan-trash";
import { updateWeeklyIntent } from "./actions";
import { ForceScheduleRefreshButton } from "./force-schedule-refresh-button";
import PerfectWeekPlannerBody from "./perfect-week-planner-body";
import { WeeklyIntentCard } from "./weekly-intent-card";
import type { PerfectWeekSliceStats, RollingSevenDayApprox } from "./perfect-week-stats-types";
import {
  approximateRollingSevenDayOccupancy,
  daySheetLoggedMinutesByGoalInWindow,
  rollingSevenDayWindowBounds
} from "@/lib/rolling-seven-day-plan-stats";

export const dynamic = "force-dynamic";

async function loadPlan(userId: string, timezone: string): Promise<WeeklyPlan> {
  const weekStart = localMondayIso(timezone);
  const blank = weeklyIntentSchema.parse({});
  if (!db) {
    return weeklyPlanSchema.parse({
      id: "dev",
      weekStart,
      timezone,
      goals: [],
      deletedGoals: [],
      goalGroups: [],
      overrides: [],
      weeklyIntent: blank
    });
  }
  const rows = await db
    .select()
    .from(schema.weeklyPlans)
    .where(eq(schema.weeklyPlans.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return weeklyPlanSchema.parse({
      id: crypto.randomUUID(),
      weekStart,
      timezone,
      goals: [],
      deletedGoals: [],
      goalGroups: [],
      overrides: [],
      weeklyIntent: blank
    });
  }
  const stored = row.data as Partial<WeeklyPlan>;
  const plan = weeklyPlanSchema.parse({
    ...stored,
    id: row.id,
    weekStart,
    timezone,
    goals: stored.goals ?? [],
    deletedGoals: stored.deletedGoals ?? [],
    goalGroups: stored.goalGroups ?? [],
    overrides: stored.overrides ?? [],
    weeklyIntent: weeklyIntentSchema.parse(stored.weeklyIntent ?? {})
  });
  return processExpiredWeeklyPlanTrash(userId, plan);
}

function dedupeIntervalLayers<T extends { startMs: number; endMs: number }>(
  xs: readonly T[],
  keyFn: (x: T) => string = (x) => `${x.startMs}|${x.endMs}`
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of xs) {
    const k = keyFn(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

export default async function PlanPage() {
  const session = await authOrPreview();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);
  const plan = await loadPlan(userId, settings.timezone);
  const billing = await loadBillingState(userId);
  const catchUpMode = settings.allocator.catchUpMode;
  const nowMs = Date.now();
  const ctx = await getCachedPlanWeekAllocationInputs({
    userId,
    plan,
    settings,
    nowMs,
    billing
  });
  const schedulingGoals = schedulingGoalsWithWeeklyRoutines(plan.goals, settings);
  const perfectWeekAuthoringGoals = filterSchedulingGoals(plan.goals);
  const resolvedCatchUpFloors = ctx.catchUpFloors;
  const {
    busyFetch,
    weekStartMs,
    weatherTimemapEvents,
    reviewsByDate,
    dayIndex,
    weekSlices,
    scheduleHorizon
  } = ctx;

  const allocationSlices = ctx.weekSlices.map((slice, idx) =>
    allocateWeek({
      plan,
      busy: [...slice.busy, ...slice.daySheetGoalBusy, ...slice.systemBlocks],
      goalAvailabilityWindows: busyFetch.goalAvailabilityWindows,
      niceWeatherWindows: slice.niceWeatherWindows,
      settings,
      weekStartMs: slice.weekStartMs,
      weekEndMs: slice.weekEndMs,
      catchUpFloors:
        idx === 0 ? resolvedCatchUpFloors : catchUpMode === "automated" ? {} : undefined,
      weekAnchorDate: idx === 0 ? plan.weekStart : slice.weekAnchorDate,
      goalOverrideSources: goalOverrideSourcesFromPlan(plan),
      nowMs,
      sleepIntervals: sleepIntervalsForAllocation(slice.systemBlocks, slice.busy)
    })
  );

  const mergedGoalBlocks = allocationSlices.flatMap((a) => a.blocks);

  const hasUserDragGoalOverrides = plan.overrides.some(
    (o) => o.kind === "goal" && (o.source ?? "drag") === "drag"
  );

  const mergeWindows = weekSlices.map((s) => ({
    weekStartMs: s.weekStartMs,
    weekEndMs: s.weekEndMs
  }));

  const busyForCalendar = dedupeIntervalLayers(
    weekSlices.flatMap((s) => s.busy),
    (e) => `${e.sourceId ?? ""}|${e.startMs}|${e.endMs}`
  );
  const daySheetGoalBusyForCalendar = dedupeIntervalLayers(
    weekSlices.flatMap((s) => s.daySheetGoalBusy),
    (e) => `${e.sourceId ?? ""}|${e.startMs}|${e.endMs}`
  );

  const allocationHorizonEndMs = weekSlices[weekSlices.length - 1]!.weekEndMs;
  const weatherPreviewBlocks = weatherTimemapEvents
    .filter((e) => e.title === "[Outside]")
    .map((e) => ({
      sourceId: `weather-${e.startMs}-${e.endMs}`,
      title: e.title,
      startMs: e.startMs,
      endMs: e.endMs,
      busy: true,
      source: "internal" as const,
      system: "weather" as const
    }));
  const invertedTimemapPreviewBlocks = invertedCalendarTimemapEvents({
    userId,
    plan,
    goalAvailabilityWindows: busyFetch.goalAvailabilityWindows,
    calendarSources: settings.calendars.sources,
    windowStartMs: weekStartMs,
    windowEndMs: allocationHorizonEndMs,
    stableUid: buildStableUid
  }).map((e) => {
    const goalTag = e.tags.find((t) => t.startsWith("goal:"));
    const invertedGoalId = goalTag ? goalTag.slice("goal:".length) : "";
    return {
      sourceId: `inverted-preview-${e.uid}`,
      title: e.title,
      startMs: e.startMs,
      endMs: e.endMs,
      busy: true,
      source: "internal" as const,
      system: "inverted-timemap" as const,
      ...(invertedGoalId ? { invertedGoalId } : {})
    };
  });
  let proposedForCalendar = filterInvertedTimemapFromProposedBlocks(
    mergeOrphanGoalOverrideBlocks(mergedGoalBlocks, plan, mergeWindows),
    plan,
    settings.calendars.sources
  );
  if (scheduleHorizon.trialRollingClip) {
    proposedForCalendar = clipIntervalBlocksToHorizon(
      proposedForCalendar,
      scheduleHorizon.horizonEndMs
    );
  }
  const gymGoalTravelOverlay = gymGoalTravelBlocksFromProposed(
    proposedForCalendar,
    schedulingGoals,
    settings.travel,
    settings.gym
  );
  const systemBlocksForCalendar = [
    ...weekSlices.flatMap((s) => s.systemBlocks),
    ...weatherPreviewBlocks,
    ...invertedTimemapPreviewBlocks,
    ...gymGoalTravelOverlay
  ];

  const calendarWeekStartsMs = weekSlices.map((s) => s.weekStartMs);
  const previewWeekLabels = weekSlices.map((s) => {
    const fmt = new Intl.DateTimeFormat("en-AU", {
      month: "short",
      day: "numeric",
      timeZone: settings.timezone
    });
    const start = fmt.format(new Date(s.weekStartMs));
    const end = fmt.format(new Date(s.weekEndMs - 24 * 60 * 60 * 1000));
    return `${start} – ${end}`;
  });

  const perfectWeekStatsBySlice: PerfectWeekSliceStats[] = allocationSlices.map((alloc, idx) => {
    const sliceMeta = weekSlices[idx]!;
    const scheduledByGoal: Record<string, number> = {};
    const effectiveTargetByGoal: Record<string, number> = {};
    const demandBeforePass3ByGoal: Record<string, number> = {};
    const allocatorRemainderHintByGoalId: Record<string, number> = {
      ...alloc.metrics.allocatorRemainderHintByGoalId
    };
    const planMinutesByGoal: Record<
      string,
      { loggedMinutes: number; proposedFutureMinutes: number }
    > = {};
    for (const [id, m] of Object.entries(alloc.metrics.perGoal)) {
      scheduledByGoal[id] = m.scheduledMinutes;
      effectiveTargetByGoal[id] = m.targetMinutes;
      demandBeforePass3ByGoal[id] = m.demandMinutesBeforePass3;
      planMinutesByGoal[id] = {
        loggedMinutes: m.loggedMinutes,
        proposedFutureMinutes: m.proposedFutureMinutes
      };
    }
    const rollupsSlice = computeGoalRollups({
      goals: schedulingGoals,
      reviewsByDate,
      effectiveTargetByGoal,
      allocatorAchievedByGoal: scheduledByGoal,
      weekDates: sliceMeta.weekDates,
      dayIndex: idx === 0 ? dayIndex : 6
    });
    const paceByGoalSlice: PerfectWeekSliceStats["paceByGoal"] = {};
    for (const r of rollupsSlice) {
      paceByGoalSlice[r.goalId] = {
        status: r.status,
        deltaMinutes: r.deltaMinutes,
        actualMinutes: r.effectiveActualMinutes,
        targetToDateMinutes: r.targetToDate
      };
    }
    return {
      weekStartMs: sliceMeta.weekStartMs,
      weekEndMs: sliceMeta.weekEndMs,
      weekDates: sliceMeta.weekDates,
      weekLabel: previewWeekLabels[idx] ?? `Week ${idx + 1}`,
      freeMinutesThisWeek: alloc.metrics.utilisation.weekCapacityMinutes,
      capacityBreakdown: {
        grossWeekMinutes: alloc.metrics.utilisation.grossWeekMinutes,
        busyWeekMinutes: alloc.metrics.utilisation.busyWeekMinutes,
        consistencyReservedWeekMinutes:
          alloc.metrics.utilisation.consistencyReservedWeekMinutes,
        busyTrueEventCount: alloc.metrics.utilisation.busyTrueEventCount
      },
      weekCapacityFromNowMinutes: alloc.metrics.utilisation.weekCapacityFromNowMinutes,
      remainingWeekMinutes: alloc.metrics.utilisation.availableMinutes,
      remainingFromNowMinutes: alloc.metrics.utilisation.availableFromNowMinutes,
      planMinutesByGoal,
      effectiveTargetByGoal,
      demandBeforePass3ByGoal,
      allocatorRemainderHintByGoalId,
      paceByGoal: paceByGoalSlice,
      goalGroupGaps: [...alloc.metrics.goalGroupGaps],
      goalGroupMinutes: alloc.metrics.goalGroupMinutes,
      overcommitted: alloc.metrics.overcommitted,
      notScheduled: alloc.metrics.notScheduled
    };
  });

  const { windowStartMs: rollWinStart, windowEndMs: rollWinEnd } = rollingSevenDayWindowBounds(
    weekStartMs,
    settings.timezone,
    nowMs
  );
  const occupiedRollBeforeGoals = approximateRollingSevenDayOccupancy({
    windowStartMs: rollWinStart,
    windowEndMs: rollWinEnd,
    busy: busyForCalendar,
    daySheetGoalBusy: daySheetGoalBusyForCalendar,
    system: systemBlocksForCalendar,
    proposed: proposedForCalendar,
    includeProposedBlocks: false
  });
  const occupiedRollWithGoals = approximateRollingSevenDayOccupancy({
    windowStartMs: rollWinStart,
    windowEndMs: rollWinEnd,
    busy: busyForCalendar,
    daySheetGoalBusy: daySheetGoalBusyForCalendar,
    system: systemBlocksForCalendar,
    proposed: proposedForCalendar,
    includeProposedBlocks: true
  });
  const loggedMinutesByGoalIdInWindow = daySheetLoggedMinutesByGoalInWindow(
    daySheetGoalBusyForCalendar,
    rollWinStart,
    rollWinEnd
  );
  const rollingSevenDayApprox: RollingSevenDayApprox = {
    windowStartMs: rollWinStart,
    windowEndMs: rollWinEnd,
    grossWindowMinutes: occupiedRollWithGoals.grossWindowMinutes,
    occupiedBeforeGoalsApproxMinutes: occupiedRollBeforeGoals.occupiedApproxMinutes,
    occupiedWithGoalsApproxMinutes: occupiedRollWithGoals.occupiedApproxMinutes,
    freeBeforeGoalsApproxMinutes: Math.max(
      0,
      occupiedRollWithGoals.grossWindowMinutes - occupiedRollBeforeGoals.occupiedApproxMinutes
    ),
    freeAfterGoalsApproxMinutes: Math.max(
      0,
      occupiedRollWithGoals.grossWindowMinutes - occupiedRollWithGoals.occupiedApproxMinutes
    ),
    proposedMinutesByGoalId: occupiedRollWithGoals.proposedMinutesByGoalId,
    loggedMinutesByGoalIdInWindow,
    effectiveTargetBaselineByGoalId: perfectWeekStatsBySlice[0]?.effectiveTargetByGoal ?? {},
    weeklyDemandBeforePass3BaselineByGoalId:
      perfectWeekStatsBySlice[0]?.demandBeforePass3ByGoal ?? {}
  };

  const allDaySheetReviews = await loadAllDailyReviewsForUser(userId);
  const goalIdsWithDaySheetHistory = Array.from(
    goalIdsReferencedInDaySheetSlotsFromReviews(allDaySheetReviews)
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold">My Perfect Week</h1>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-200">
            List the things you want each week — including{" "}
            <strong>Physical activity</strong> (gym preset with drive padding). Type a goal and press
            Enter — we&apos;ll find the time. Optional <strong>scheduling methods</strong> (e.g.
            energy-aware placement) live on{" "}
            <Link className="underline" href="/dashboard/planner#framework-methods">
              Planner
            </Link>{" "}
            with your frameworks.
          </p>
        </div>
        <ForceScheduleRefreshButton />
      </header>

      <WeeklyIntentCard initial={plan.weeklyIntent} save={updateWeeklyIntent} />

      <PerfectWeekPlannerBody
        calendarWeekStartsMs={calendarWeekStartsMs}
        previewWeekLabels={previewWeekLabels}
        timezone={settings.timezone}
        nowMs={nowMs}
        perfectWeekStatsBySlice={perfectWeekStatsBySlice}
        rollingSevenDayApprox={rollingSevenDayApprox}
        isoWeekStartsForRolling={calendarWeekStartsMs}
        busyForCalendar={busyForCalendar}
        daySheetGoalBusyForCalendar={daySheetGoalBusyForCalendar}
        systemBlocksForCalendar={systemBlocksForCalendar}
        proposedForCalendar={proposedForCalendar}
        schedulingGoals={schedulingGoals}
        frameworkSystem={settings.frameworkSystem}
        wheelAreas={settings.wheel.areas.map((a) => ({ id: a.id, label: a.label }))}
        goalGroups={plan.goalGroups ?? []}
        hasUserDragGoalOverrides={hasUserDragGoalOverrides}
        planClientGoals={perfectWeekAuthoringGoals}
        gymTemplate={settings.gym}
        planClientDeletedGoals={plan.deletedGoals}
        goalIdsWithDaySheetHistory={goalIdsWithDaySheetHistory}
        goalGroupTitles={Object.fromEntries((plan.goalGroups ?? []).map((g) => [g.id, g.title]))}
      />
    </div>
  );
}

