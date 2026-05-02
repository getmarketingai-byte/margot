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
  getCachedPlanWeekAllocationInputs,
  invalidateUserAllocationCache
} from "@/lib/cached-plan-week-allocation-inputs";
import { revalidatePlanningRoutes } from "@/lib/dashboard-revalidate";
import { db, schema } from "@/lib/db";
import { loadSettings, saveSettings } from "@/lib/settings-store";
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
import { PlanClient } from "./plan-client";
import { ResizableColumns } from "./resizable-columns";
import { WeeklyIntentCard } from "./weekly-intent-card";
import { WeekCalendar } from "../week-calendar";
import { RangeToggleCalendar } from "./range-toggle-calendar";

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
  const perfectWeekAuthoringGoals = filterSchedulingGoals(plan.goals).filter(
    (g) => g.specialGoalType !== "gym"
  );
  const resolvedCatchUpFloors = ctx.catchUpFloors;
  const {
    busyFetch,
    weekStartMs,
    weekEndMs,
    weatherTimemapEvents,
    weekDates,
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

  const allocation = allocationSlices[0]!;
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

  const scheduledByGoal: Record<string, number> = {};
  const effectiveTargetByGoal: Record<string, number> = {};
  const planMinutesByGoal: Record<string, { loggedMinutes: number; proposedFutureMinutes: number }> =
    {};
  for (const [id, m] of Object.entries(allocation.metrics.perGoal)) {
    scheduledByGoal[id] = m.scheduledMinutes;
    effectiveTargetByGoal[id] = m.targetMinutes;
    planMinutesByGoal[id] = {
      loggedMinutes: m.loggedMinutes,
      proposedFutureMinutes: m.proposedFutureMinutes
    };
  }

  // Pace rollups: day-sheet vs final allocator targets for badges.
  const goalRollups = computeGoalRollups({
    goals: schedulingGoals,
    reviewsByDate,
    effectiveTargetByGoal,
    allocatorAchievedByGoal: scheduledByGoal,
    weekDates,
    dayIndex
  });
  const paceByGoal: Record<
    string,
    {
      status: import("@/lib/review-rollup").PaceStatus;
      deltaMinutes: number;
      actualMinutes: number;
      targetToDateMinutes: number;
    }
  > = {};
  for (const r of goalRollups) {
    paceByGoal[r.goalId] = {
      status: r.status,
      deltaMinutes: r.deltaMinutes,
      actualMinutes: r.effectiveActualMinutes,
      targetToDateMinutes: r.targetToDate
    };
  }

  const allDaySheetReviews = await loadAllDailyReviewsForUser(userId);
  const goalIdsWithDaySheetHistory = Array.from(
    goalIdsReferencedInDaySheetSlotsFromReviews(allDaySheetReviews)
  );

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">My Perfect Week</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          List the things you want each week. Type a goal and press Enter — we&apos;ll find the
          time.           Optional <strong>scheduling methods</strong> (e.g. energy-aware placement) live on{" "}
          <Link className="underline" href="/dashboard/planner#framework-methods">
            Planner
          </Link>{" "}
          with your frameworks.
        </p>
      </header>

      <WeeklyIntentCard initial={plan.weeklyIntent} save={updateWeeklyIntent} />

      {allocation.metrics.overcommitted ? (
        <Overcommitted
          neededMin={allocation.metrics.overcommitted.neededMin}
          availableMin={allocation.metrics.overcommitted.availableMin}
          mode={allocation.metrics.overcommitted.mode}
        />
      ) : null}

      <ResizableColumns
        left={
          <div className="flex flex-col gap-5">
            <PlanClient
              initialGoals={perfectWeekAuthoringGoals}
              initialDeletedGoals={plan.deletedGoals}
              freeMinutesThisWeek={allocation.metrics.utilisation.weekCapacityMinutes}
              capacityBreakdown={{
                grossWeekMinutes: allocation.metrics.utilisation.grossWeekMinutes,
                busyWeekMinutes: allocation.metrics.utilisation.busyWeekMinutes,
                consistencyReservedWeekMinutes:
                  allocation.metrics.utilisation.consistencyReservedWeekMinutes,
                busyTrueEventCount: allocation.metrics.utilisation.busyTrueEventCount
              }}
              weekCapacityFromNowMinutes={allocation.metrics.utilisation.weekCapacityFromNowMinutes}
              remainingWeekMinutes={allocation.metrics.utilisation.availableMinutes}
              remainingFromNowMinutes={allocation.metrics.utilisation.availableFromNowMinutes}
              wheelAreas={settings.wheel.areas.map((a) => ({ id: a.id, label: a.label }))}
              planMinutesByGoal={planMinutesByGoal}
              effectiveTargetByGoal={effectiveTargetByGoal}
              paceByGoal={paceByGoal}
              goalGroupTitles={Object.fromEntries((plan.goalGroups ?? []).map((g) => [g.id, g.title]))}
              goalGroups={plan.goalGroups ?? []}
              goalIdsWithDaySheetHistory={goalIdsWithDaySheetHistory}
            />

            {allocation.metrics.notScheduled.length > 0 && (
              <section className="card border-amber-300/40">
                <h2 className="text-sm font-semibold">Not scheduled this week</h2>
                <p className="text-xs text-ink-400">
                  With strict mode on, these goals didn&apos;t fit. Either soften their floors or
                  switch to proportional under{" "}
                  <Link className="underline" href="/dashboard/planner#scheduling-outcomes">
                    Scheduling options
                  </Link>{" "}
                  on Planner.
                </p>
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {allocation.metrics.notScheduled.map((n) => (
                    <li key={n.goalId}>{n.title}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        }
        right={
          <>
            {/*
              On large screens this column becomes a sticky right rail so the
              calendar stays visible while the goals list scrolls. On small
              screens it stacks above the goals as a collapsible details block.
            */}
            <div className="lg:sticky lg:top-6 lg:self-start">
              <div className="hidden lg:block">
                <CalendarPreview
                  weekStartMs={weekStartMs}
                  calendarWeekStartsMs={calendarWeekStartsMs}
                  previewWeekLabels={previewWeekLabels}
                  timezone={settings.timezone}
                  busy={busyForCalendar}
                  daySheetGoalBusy={daySheetGoalBusyForCalendar}
                  system={systemBlocksForCalendar}
                  proposed={proposedForCalendar}
                  compact
                  schedulingGoals={schedulingGoals}
                  frameworkSystem={settings.frameworkSystem}
                  wheelAreas={settings.wheel.areas.map((a) => ({ id: a.id, label: a.label }))}
                  goalGroups={plan.goalGroups ?? []}
                  goalGroupGaps={allocation.metrics.goalGroupGaps}
                  goalGroupMinutes={allocation.metrics.goalGroupMinutes}
                  hasUserDragGoalOverrides={hasUserDragGoalOverrides}
                />
              </div>
              <details className="card lg:hidden" open>
                <summary className="cursor-pointer text-sm font-semibold">Preview this week</summary>
                <div className="mt-3">
                  <RangeToggleCalendar
                    weekStartMs={weekStartMs}
                    calendarWeekStartsMs={calendarWeekStartsMs}
                    previewWeekLabels={previewWeekLabels}
                    timezone={settings.timezone}
                    busy={busyForCalendar}
                    daySheetGoalBusy={daySheetGoalBusyForCalendar}
                    system={systemBlocksForCalendar}
                    proposed={proposedForCalendar}
                    schedulingGoals={schedulingGoals}
                    frameworkSystem={settings.frameworkSystem}
                    wheelAreas={settings.wheel.areas.map((a) => ({ id: a.id, label: a.label }))}
                    goalGroups={plan.goalGroups ?? []}
                    goalGroupGaps={allocation.metrics.goalGroupGaps}
                    goalGroupMinutes={allocation.metrics.goalGroupMinutes}
                    hasUserDragGoalOverrides={hasUserDragGoalOverrides}
                  />
                </div>
              </details>
            </div>
          </>
        }
      />
    </div>
  );
}

function CalendarPreview({
  weekStartMs,
  calendarWeekStartsMs,
  previewWeekLabels,
  timezone,
  busy,
  daySheetGoalBusy,
  system,
  proposed,
  compact,
  schedulingGoals,
  frameworkSystem,
  wheelAreas,
  goalGroups,
  goalGroupGaps,
  goalGroupMinutes,
  hasUserDragGoalOverrides
}: {
  weekStartMs: number;
  calendarWeekStartsMs?: readonly number[];
  previewWeekLabels?: readonly string[];
  timezone: string;
  busy: Parameters<typeof WeekCalendar>[0]["busy"];
  daySheetGoalBusy: Parameters<typeof WeekCalendar>[0]["daySheetGoalBusy"];
  system: Parameters<typeof WeekCalendar>[0]["system"];
  proposed: Parameters<typeof WeekCalendar>[0]["proposed"];
  compact: boolean;
  schedulingGoals: Parameters<typeof RangeToggleCalendar>[0]["schedulingGoals"];
  frameworkSystem: Parameters<typeof RangeToggleCalendar>[0]["frameworkSystem"];
  wheelAreas: Parameters<typeof RangeToggleCalendar>[0]["wheelAreas"];
  goalGroups?: Parameters<typeof RangeToggleCalendar>[0]["goalGroups"];
  goalGroupGaps?: Parameters<typeof RangeToggleCalendar>[0]["goalGroupGaps"];
  goalGroupMinutes?: Parameters<typeof RangeToggleCalendar>[0]["goalGroupMinutes"];
  hasUserDragGoalOverrides: boolean;
}) {
  return (
    <RangeToggleCalendar
      weekStartMs={weekStartMs}
      calendarWeekStartsMs={calendarWeekStartsMs}
      previewWeekLabels={previewWeekLabels}
      timezone={timezone}
      busy={busy}
      daySheetGoalBusy={daySheetGoalBusy}
      system={system ?? []}
      proposed={proposed}
      compact={compact}
      schedulingGoals={schedulingGoals}
      frameworkSystem={frameworkSystem}
      wheelAreas={wheelAreas}
      goalGroups={goalGroups}
      goalGroupGaps={goalGroupGaps}
      goalGroupMinutes={goalGroupMinutes}
      hasUserDragGoalOverrides={hasUserDragGoalOverrides}
    />
  );
}

function Overcommitted({
  neededMin,
  availableMin,
  mode
}: {
  neededMin: number;
  availableMin: number;
  mode: "proportional" | "strict";
}) {
  const trimPercent = Math.max(0, Math.round(((neededMin - availableMin) / neededMin) * 100));
  return (
    <section className="card border-amber-300/40 bg-amber-50/30 dark:bg-amber-900/10">
      <div className="text-sm font-semibold">You&apos;re overcommitted</div>
      <p className="mt-1 text-xs text-ink-600 dark:text-ink-200">
        Your minimums need {Math.round(neededMin / 60)}h but only {Math.round(availableMin / 60)}h
        are free.{" "}
        {mode === "proportional"
          ? `Every goal is being trimmed by ~${trimPercent}%.`
          : "Floors are being paid in order; later goals may be skipped this week."}
      </p>
    </section>
  );
}
