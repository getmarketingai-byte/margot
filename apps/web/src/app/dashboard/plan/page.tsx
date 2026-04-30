import { eq } from "drizzle-orm";
import Link from "next/link";
import {
  filterSchedulingGoals,
  type WeeklyPlan,
  weeklyIntentSchema
} from "@calendar-automations/schema";
import { allocateWeek, buildStableUid, goalOverrideSourcesFromPlan } from "@calendar-automations/planner";
import { authOrPreview } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { loadPlanWeekAllocationInputs } from "@/lib/allocation-run-context";
import { loadSettings, saveSettings } from "@/lib/settings-store";
import { localMondayIso } from "@/lib/week";
import { gymGoalTravelBlocksFromProposed, sleepIntervalsFromSystemBlocks } from "@/lib/week-blocks";
import { computeGoalRollups } from "@/lib/review-rollup";
import { filterInvertedTimemapFromProposedBlocks } from "@/lib/proposed-calendar-filter";
import { mergeOrphanGoalOverrideBlocks } from "@/lib/merge-orphan-goal-override-blocks";
import { invertedCalendarTimemapEvents } from "@/lib/inverted-timemap-ics-events";
import { PlanClient } from "./plan-client";
import { ResizableColumns } from "./resizable-columns";
import { WeekCalendar } from "../week-calendar";
import { RangeToggleCalendar } from "./range-toggle-calendar";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

async function loadPlan(userId: string, timezone: string): Promise<WeeklyPlan> {
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

async function updateRoutines(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const morningEnabled = formData.get("morning_enabled") === "on";
  const shutdownEnabled = formData.get("shutdown_enabled") === "on";
  const morningMinutes = Math.max(
    0,
    Math.min(180, Number(formData.get("morning_minutes") ?? settings.timemap.morningRoutine.minutes))
  );
  const shutdownMinutes = Math.max(
    0,
    Math.min(180, Number(formData.get("shutdown_minutes") ?? settings.timemap.shutdownRoutine.minutes))
  );

  await saveSettings(userId, {
    ...settings,
    timemap: {
      ...settings.timemap,
      morningRoutine: {
        ...settings.timemap.morningRoutine,
        enabled: morningEnabled,
        minutes: morningMinutes
      },
      shutdownRoutine: {
        ...settings.timemap.shutdownRoutine,
        enabled: shutdownEnabled,
        minutes: shutdownMinutes
      }
    }
  });

  revalidatePath("/dashboard/plan");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/energy");
}

export default async function PlanPage() {
  const session = await authOrPreview();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);
  const plan = await loadPlan(userId, settings.timezone);
  const catchUpMode = settings.allocator.catchUpMode;
  const nowMs = Date.now();
  const ctx = await loadPlanWeekAllocationInputs({ userId, plan, settings, nowMs });
  const schedulingGoals = filterSchedulingGoals(plan.goals);
  const resolvedCatchUpFloors = ctx.catchUpFloors;
  const {
    busyFetch,
    weekStartMs,
    weekEndMs,
    nextWeekStartMs,
    nextWeekEndMs,
    busy,
    busyNextWeek,
    systemBlocks,
    nextWeekSystemBlocks,
    weatherTimemapEvents,
    niceWeatherThisWeek,
    niceWeatherNextWeek,
    weekDates,
    reviewsByDate,
    dayIndex,
    nextWeekAnchor,
    daySheetGoalBusyThisWeek,
    daySheetGoalBusyNextWeek
  } = ctx;

  const allocation = allocateWeek({
    plan,
    busy: [...busy, ...daySheetGoalBusyThisWeek, ...systemBlocks],
    goalAvailabilityWindows: busyFetch.goalAvailabilityWindows,
    niceWeatherWindows: niceWeatherThisWeek,
    settings,
    weekStartMs,
    weekEndMs,
    catchUpFloors: resolvedCatchUpFloors,
    weekAnchorDate: plan.weekStart,
    goalOverrideSources: goalOverrideSourcesFromPlan(plan),
    nowMs,
    sleepIntervals: sleepIntervalsFromSystemBlocks(systemBlocks)
  });

  const allocationNextWeek = allocateWeek({
    plan,
    busy: [...busyNextWeek, ...daySheetGoalBusyNextWeek, ...nextWeekSystemBlocks],
    goalAvailabilityWindows: busyFetch.goalAvailabilityWindows,
    niceWeatherWindows: niceWeatherNextWeek,
    settings,
    weekStartMs: nextWeekStartMs,
    weekEndMs: nextWeekEndMs,
    catchUpFloors: catchUpMode === "automated" ? {} : undefined,
    weekAnchorDate: nextWeekAnchor,
    goalOverrideSources: goalOverrideSourcesFromPlan(plan),
    nowMs,
    sleepIntervals: sleepIntervalsFromSystemBlocks(nextWeekSystemBlocks)
  });

  const catchUpActive = Object.entries(resolvedCatchUpFloors).some(([, mins]) => mins !== 0);
  const busyForCalendar = [...busy, ...busyNextWeek];
  const daySheetGoalBusyForCalendar = [...daySheetGoalBusyThisWeek, ...daySheetGoalBusyNextWeek];
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
    windowEndMs: nextWeekEndMs,
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
  const proposedForCalendar = filterInvertedTimemapFromProposedBlocks(
    mergeOrphanGoalOverrideBlocks(
      [...allocation.blocks, ...allocationNextWeek.blocks],
      plan,
      [
        { weekStartMs, weekEndMs },
        { weekStartMs: nextWeekStartMs, weekEndMs: nextWeekEndMs }
      ]
    ),
    plan,
    settings.calendars.sources
  );
  const gymGoalTravelOverlay = gymGoalTravelBlocksFromProposed(
    proposedForCalendar,
    plan.goals,
    settings.travel,
    settings.gym
  );
  const systemBlocksForCalendar = [
    ...systemBlocks,
    ...nextWeekSystemBlocks,
    ...weatherPreviewBlocks,
    ...invertedTimemapPreviewBlocks,
    ...gymGoalTravelOverlay
  ];

  const scheduledByGoal: Record<string, number> = {};
  const effectiveTargetByGoal: Record<string, number> = {};
  for (const [id, m] of Object.entries(allocation.metrics.perGoal)) {
    scheduledByGoal[id] = m.scheduledMinutes;
    effectiveTargetByGoal[id] = m.targetMinutes;
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

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">My Perfect Week</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          List the things you want each week. Type a goal and press Enter — we&apos;ll find the
          time. Optional <strong>scheduling methods</strong> (e.g. energy-aware placement) live on{" "}
          <Link className="underline" href="/dashboard/energy#personal-scheduling">
            Planning
          </Link>{" "}
          with your frameworks.
        </p>
      </header>

      {catchUpActive && (
        <CatchUpBanner
          adjustments={resolvedCatchUpFloors}
          goals={schedulingGoals}
          mode={catchUpMode}
        />
      )}

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
              initialGoals={schedulingGoals}
              freeMinutesThisWeek={allocation.metrics.utilisation.weekCapacityMinutes}
              weekCapacityFromNowMinutes={allocation.metrics.utilisation.weekCapacityFromNowMinutes}
              remainingWeekMinutes={allocation.metrics.utilisation.availableMinutes}
              remainingFromNowMinutes={allocation.metrics.utilisation.availableFromNowMinutes}
              wheelAreas={settings.wheel.areas.map((a) => ({ id: a.id, label: a.label }))}
              scheduledByGoal={scheduledByGoal}
              effectiveTargetByGoal={effectiveTargetByGoal}
              paceByGoal={paceByGoal}
            />

            <section className="card">
              <div className="text-sm font-semibold">Daily routines</div>
              <p className="mt-1 text-xs text-ink-400">
                Morning and shutdown routines are reserved around sleep and block planner time-map
                slots from being placed in the same window.
              </p>
              <form action={updateRoutines} className="mt-3 grid gap-4 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-3">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      name="morning_enabled"
                      defaultChecked={settings.timemap.morningRoutine.enabled}
                    />
                    <span>Enable morning routine</span>
                  </label>
                  <label className="flex min-w-0 flex-col gap-1 text-xs">
                    Morning minutes
                    <input
                      type="number"
                      name="morning_minutes"
                      min={0}
                      max={180}
                      step={5}
                      defaultValue={settings.timemap.morningRoutine.minutes}
                      className="field w-full"
                    />
                  </label>
                </div>
                <div className="flex min-w-0 flex-col gap-3">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      name="shutdown_enabled"
                      defaultChecked={settings.timemap.shutdownRoutine.enabled}
                    />
                    <span>Enable shutdown routine</span>
                  </label>
                  <label className="flex min-w-0 flex-col gap-1 text-xs">
                    Shutdown minutes
                    <input
                      type="number"
                      name="shutdown_minutes"
                      min={0}
                      max={180}
                      step={5}
                      defaultValue={settings.timemap.shutdownRoutine.minutes}
                      className="field w-full"
                    />
                  </label>
                </div>
                <div className="sm:col-span-2">
                  <button type="submit" className="btn-primary w-full text-xs">
                    Save routines
                  </button>
                </div>
              </form>
            </section>

            {allocation.metrics.notScheduled.length > 0 && (
              <section className="card border-amber-300/40">
                <h2 className="text-sm font-semibold">Not scheduled this week</h2>
                <p className="text-xs text-ink-400">
                  With strict mode on, these goals didn&apos;t fit. Either soften their floors or
                  switch to proportional under{" "}
                  <Link className="underline" href="/dashboard/energy#scheduling-constraints">
                    Scheduling rules
                  </Link>{" "}
                  on Planning.
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
              screens it stacks below the goals as a collapsible details block.
            */}
            <div className="lg:sticky lg:top-6 lg:self-start">
              <div className="hidden lg:block">
                <CalendarPreview
                  weekStartMs={weekStartMs}
                  timezone={settings.timezone}
                  busy={busyForCalendar}
                  daySheetGoalBusy={daySheetGoalBusyForCalendar}
                  system={systemBlocksForCalendar}
                  proposed={proposedForCalendar}
                  compact
                />
              </div>
              <details className="card lg:hidden" open>
                <summary className="cursor-pointer text-sm font-semibold">Preview this week</summary>
                <div className="mt-3">
                  <RangeToggleCalendar
                    weekStartMs={weekStartMs}
                    timezone={settings.timezone}
                    busy={busyForCalendar}
                    daySheetGoalBusy={daySheetGoalBusyForCalendar}
                    system={systemBlocksForCalendar}
                    proposed={proposedForCalendar}
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
  timezone,
  busy,
  daySheetGoalBusy,
  system,
  proposed,
  compact
}: {
  weekStartMs: number;
  timezone: string;
  busy: Parameters<typeof WeekCalendar>[0]["busy"];
  daySheetGoalBusy: Parameters<typeof WeekCalendar>[0]["daySheetGoalBusy"];
  system: Parameters<typeof WeekCalendar>[0]["system"];
  proposed: Parameters<typeof WeekCalendar>[0]["proposed"];
  compact: boolean;
}) {
  return (
    <RangeToggleCalendar
      weekStartMs={weekStartMs}
      timezone={timezone}
      busy={busy}
      daySheetGoalBusy={daySheetGoalBusy}
      system={system ?? []}
      proposed={proposed}
      compact={compact}
    />
  );
}

function CatchUpBanner({
  adjustments,
  goals,
  mode
}: {
  adjustments: Record<string, number>;
  goals: WeeklyPlan["goals"];
  mode: "automated" | "manual";
}) {
  const titleById = new Map(goals.map((g) => [g.id, g.title] as const));
  const entries = Object.entries(adjustments).filter(([, mins]) => mins !== 0);
  const summary = entries
    .map(([id, mins]) => {
      const title = titleById.get(id) ?? id;
      const sign = mins > 0 ? "+" : "";
      return `${title} ${sign}${mins}m`;
    })
    .join(", ");
  const secondaryHref =
    mode === "automated" ? "/dashboard/energy#scheduling-constraints" : "/dashboard/week-review";
  const secondaryLabel = mode === "automated" ? "Catch-up settings" : "Adjust catch-up";
  const blurb =
    mode === "automated"
      ? `Based on your day sheet vs baseline targets, extra weekly floors are applied for ${entries.length} ${entries.length === 1 ? "goal" : "goals"}: ${summary}.`
      : `Allocator is reserving extra time for ${entries.length} ${entries.length === 1 ? "goal" : "goals"}: ${summary}.`;
  return (
    <section className="card border-amber-300/40 bg-amber-50/30 dark:bg-amber-900/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Catch-up active</div>
          <p className="mt-1 text-xs text-ink-600 dark:text-ink-200">{blurb}</p>
        </div>
        <Link href={secondaryHref} className="btn-secondary text-xs">
          {secondaryLabel}
        </Link>
      </div>
    </section>
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
