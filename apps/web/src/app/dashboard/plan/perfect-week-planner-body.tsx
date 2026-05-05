"use client";

import Link from "next/link";
import type {
  AllocatorGoalWindowMode,
  GoalGroup,
  GymSettings,
  WeeklyGoal
} from "@calendar-automations/schema";
import { hybridAnyLinearGoalBlocksTimemaps } from "@calendar-automations/schema";
import { useMemo } from "react";
import { PlanCalendarViewProvider, usePlanCalendarView } from "./plan-calendar-view-context";
import type { GoalGroupRailBundle, PerfectWeekSliceStats, RollingSevenDayApprox } from "./perfect-week-stats-types";
import { PlanClient } from "./plan-client";
import { RangeToggleCalendar } from "./range-toggle-calendar";
import { ResizableColumns } from "./resizable-columns";
import {
  rollingSevenDayWindowBounds,
  rollingSpansTwoIsoWeeks,
  touchedSliceIndexesForRollingWindow
} from "@/lib/rolling-seven-day-plan-stats";

function Overcommitted({
  neededMin,
  availableMin,
  mode,
  subtitle
}: {
  neededMin: number;
  availableMin: number;
  mode: "proportional" | "strict";
  subtitle?: string;
}) {
  const trimPercent = Math.max(0, Math.round(((neededMin - availableMin) / neededMin) * 100));
  return (
    <section className="card border-amber-300/40 bg-amber-50/30 dark:bg-amber-900/10">
      <div className="text-sm font-semibold">You&apos;re overcommitted</div>
      {subtitle ? (
        <p className="mt-1 text-[11px] text-ink-500 dark:text-ink-400">{subtitle}</p>
      ) : null}
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

function OvercommittedForActiveSlices({
  isoWeekStartsMs,
  timezone,
  nowMs,
  perfectWeekStatsBySlice
}: {
  isoWeekStartsMs: readonly number[];
  timezone: string;
  nowMs: number;
  perfectWeekStatsBySlice: readonly PerfectWeekSliceStats[];
}) {
  const { rangeMode, previewWeekIdx, rollingStatsMode } = usePlanCalendarView();
  const safeIdx = Math.min(previewWeekIdx, Math.max(0, perfectWeekStatsBySlice.length - 1));

  const items = useMemo(() => {
    if (rangeMode === "calendar-week") {
      const s = perfectWeekStatsBySlice[safeIdx];
      return s?.overcommitted
        ? [
            {
              key: `${s.weekStartMs}-oc`,
              neededMin: s.overcommitted.neededMin,
              availableMin: s.overcommitted.availableMin,
              mode: s.overcommitted.mode,
              subtitle: `Allocation window · ${s.weekLabel}`
            }
          ]
        : [];
    }
    const ws = isoWeekStartsMs[0]!;
    const { windowStartMs, windowEndMs } = rollingSevenDayWindowBounds(ws, timezone, nowMs);
    const touched = touchedSliceIndexesForRollingWindow(isoWeekStartsMs, windowStartMs, windowEndMs);
    let consider = [...new Set(touched)].filter((i) => i >= 0 && i < perfectWeekStatsBySlice.length);
    if (
      !(
        rollingStatsMode === "split" &&
        rollingSpansTwoIsoWeeks(ws, timezone, nowMs) &&
        consider.length > 1
      )
    ) {
      consider = consider.length > 0 ? [consider[0]!] : [0];
    }
    const out: Array<{
      key: string;
      neededMin: number;
      availableMin: number;
      mode: "proportional" | "strict";
      subtitle?: string;
    }> = [];
    for (const i of consider) {
      const s = perfectWeekStatsBySlice[i];
      if (!s?.overcommitted) continue;
      out.push({
        key: `${s.weekStartMs}-oc-roll`,
        neededMin: s.overcommitted.neededMin,
        availableMin: s.overcommitted.availableMin,
        mode: s.overcommitted.mode,
        subtitle: `Allocation window · ${s.weekLabel}`
      });
    }
    return out;
  }, [
    isoWeekStartsMs,
    timezone,
    nowMs,
    perfectWeekStatsBySlice,
    previewWeekIdx,
    rangeMode,
    rollingStatsMode,
    safeIdx
  ]);

  return (
    <>
      {items.map((it) => (
        <Overcommitted
          key={it.key}
          neededMin={it.neededMin}
          availableMin={it.availableMin}
          mode={it.mode}
          subtitle={it.subtitle}
        />
      ))}
    </>
  );
}

function NotScheduledForActiveSlices({
  isoWeekStartsMs,
  timezone,
  nowMs,
  perfectWeekStatsBySlice
}: {
  isoWeekStartsMs: readonly number[];
  timezone: string;
  nowMs: number;
  perfectWeekStatsBySlice: readonly PerfectWeekSliceStats[];
}) {
  const { rangeMode, previewWeekIdx, rollingStatsMode } = usePlanCalendarView();
  const safeIdx = Math.min(previewWeekIdx, Math.max(0, perfectWeekStatsBySlice.length - 1));

  const blocks = useMemo(() => {
    if (rangeMode === "calendar-week") {
      const s = perfectWeekStatsBySlice[safeIdx];
      if (!s || s.notScheduled.length === 0) return [];
      return [{ label: s.weekLabel, entries: s.notScheduled }];
    }
    const ws = isoWeekStartsMs[0]!;
    const { windowStartMs, windowEndMs } = rollingSevenDayWindowBounds(ws, timezone, nowMs);
    const touched = touchedSliceIndexesForRollingWindow(isoWeekStartsMs, windowStartMs, windowEndMs);
    let consider = [...new Set(touched)].filter((i) => i >= 0 && i < perfectWeekStatsBySlice.length);
    if (
      !(rollingStatsMode === "split" && rollingSpansTwoIsoWeeks(ws, timezone, nowMs) && consider.length > 1)
    ) {
      consider = consider.length > 0 ? [consider[0]!] : [0];
    }
    const out: Array<{ label: string; entries: PerfectWeekSliceStats["notScheduled"] }> = [];
    const seenGoal = new Set<string>();
    for (const i of consider) {
      const s = perfectWeekStatsBySlice[i];
      if (!s?.notScheduled.length) continue;
      const deduped = s.notScheduled.filter((n) => {
        if (seenGoal.has(n.goalId)) return false;
        seenGoal.add(n.goalId);
        return true;
      });
      if (deduped.length === 0) continue;
      out.push({ label: s.weekLabel, entries: deduped });
    }
    return out;
  }, [
    isoWeekStartsMs,
    timezone,
    nowMs,
    perfectWeekStatsBySlice,
    previewWeekIdx,
    rangeMode,
    rollingStatsMode,
    safeIdx
  ]);

  if (blocks.length === 0) return null;

  return (
    <>
      {blocks.map((b, i) => (
        <section key={`${b.label}-${String(i)}`} className="card border-amber-300/40">
          <h2 className="text-sm font-semibold">
            Not scheduled
            <span className="font-normal text-ink-500"> · {b.label}</span>
          </h2>
          <p className="text-xs text-ink-400">
            With strict mode on, these goals didn&apos;t fit. Either soften their floors or switch to
            proportional under{" "}
            <Link className="underline" href="/dashboard/planner#scheduling-outcomes">
              Scheduling options
            </Link>{" "}
            on Planner (physical activity itself is a Perfect Week goal row).
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {b.entries.map((n) => (
              <li key={`${n.goalId}-${b.label}`}>{n.title}</li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

interface PerfectWeekPlannerBodyProps {
  calendarWeekStartsMs: readonly number[];
  previewWeekLabels: readonly string[];
  timezone: string;
  nowMs: number;
  perfectWeekStatsBySlice: readonly PerfectWeekSliceStats[];
  rollingSevenDayApprox: RollingSevenDayApprox;
  isoWeekStartsForRolling: readonly number[];
  busyForCalendar: Parameters<typeof RangeToggleCalendar>[0]["busy"];
  daySheetGoalBusyForCalendar: Parameters<typeof RangeToggleCalendar>[0]["daySheetGoalBusy"];
  systemBlocksForCalendar: Parameters<typeof RangeToggleCalendar>[0]["system"];
  proposedForCalendar: Parameters<typeof RangeToggleCalendar>[0]["proposed"];
  schedulingGoals: Parameters<typeof RangeToggleCalendar>[0]["schedulingGoals"];
  ribbonLaneOrderingGoals: Parameters<typeof RangeToggleCalendar>[0]["ribbonLaneOrderingGoals"];
  frameworkSystem: Parameters<typeof RangeToggleCalendar>[0]["frameworkSystem"];
  wheelAreas?: Parameters<typeof RangeToggleCalendar>[0]["wheelAreas"];
  goalGroups?: readonly GoalGroup[];
  hasUserDragGoalOverrides: boolean;
  planClientGoals: WeeklyGoal[];
  /** Snapshot for “+ Physical activity” quick-add defaults (cadence, windows). */
  gymTemplate: GymSettings;
  planClientDeletedGoals: Parameters<typeof PlanClient>[0]["initialDeletedGoals"];
  goalIdsWithDaySheetHistory: readonly string[];
  goalGroupTitles: Record<string, string>;
  allocatorGoalWindowMode: AllocatorGoalWindowMode;
}

export default function PerfectWeekPlannerBody(props: PerfectWeekPlannerBodyProps) {
  return (
    <PlanCalendarViewProvider calendarWeekStartsKey={props.calendarWeekStartsMs.join("|")}>
      <PerfectWeekPlannerInner {...props} />
    </PlanCalendarViewProvider>
  );
}

function useGoalGroupRailBundles({
  isoWeekStartsMs,
  timezone,
  nowMs,
  perfectWeekStatsBySlice
}: {
  isoWeekStartsMs: readonly number[];
  timezone: string;
  nowMs: number;
  perfectWeekStatsBySlice: readonly PerfectWeekSliceStats[];
}): GoalGroupRailBundle[] {
  const { rangeMode, previewWeekIdx, rollingStatsMode } = usePlanCalendarView();
  const safeIdx = Math.min(previewWeekIdx, Math.max(0, perfectWeekStatsBySlice.length - 1));

  return useMemo(() => {
    if (rangeMode === "calendar-week") {
      const s = perfectWeekStatsBySlice[safeIdx];
      return s
        ? [{ gaps: [...s.goalGroupGaps], minutes: { ...s.goalGroupMinutes }, weekLabel: s.weekLabel }]
        : [];
    }
    const ws = isoWeekStartsMs[0]!;
    const { windowStartMs, windowEndMs } = rollingSevenDayWindowBounds(ws, timezone, nowMs);
    let consider = [...new Set(touchedSliceIndexesForRollingWindow(isoWeekStartsMs, windowStartMs, windowEndMs))].filter(
      (i) => i >= 0 && i < perfectWeekStatsBySlice.length
    );
    if (
      !(rollingStatsMode === "split" && rollingSpansTwoIsoWeeks(ws, timezone, nowMs) && consider.length > 1)
    ) {
      consider = consider.length > 0 ? [consider[0]!] : [0];
    }
    const out: GoalGroupRailBundle[] = [];
    const seenGapKey = new Set<string>();
    for (const idx of consider) {
      const s = perfectWeekStatsBySlice[idx];
      if (!s) continue;
      const gaps = [...s.goalGroupGaps].filter((g) => {
        const key = `${g.groupId}:${g.reason}:${String(g.dayIndex ?? "")}`;
        if (seenGapKey.has(key)) return false;
        seenGapKey.add(key);
        return true;
      });
      out.push({ gaps, minutes: { ...s.goalGroupMinutes }, weekLabel: s.weekLabel });
    }
    return out;
  }, [
    isoWeekStartsMs,
    timezone,
    nowMs,
    perfectWeekStatsBySlice,
    previewWeekIdx,
    rangeMode,
    rollingStatsMode,
    safeIdx
  ]);
}

function PerfectWeekPlannerInner(props: PerfectWeekPlannerBodyProps) {
  const {
    calendarWeekStartsMs,
    previewWeekLabels,
    timezone,
    nowMs,
    perfectWeekStatsBySlice,
    rollingSevenDayApprox,
    isoWeekStartsForRolling,
    busyForCalendar,
    daySheetGoalBusyForCalendar,
    systemBlocksForCalendar,
    proposedForCalendar,
    schedulingGoals,
    ribbonLaneOrderingGoals,
    frameworkSystem,
    wheelAreas,
    goalGroups = [],
    hasUserDragGoalOverrides,
    planClientGoals,
    gymTemplate,
    planClientDeletedGoals,
    goalIdsWithDaySheetHistory,
    goalGroupTitles,
    allocatorGoalWindowMode
  } = props;

  const weekStartMsView = isoWeekStartsForRolling[0] ?? calendarWeekStartsMs[0]!;
  const stackedTimemapRibbonsAboveProposedGoals = useMemo(
    () =>
      allocatorGoalWindowMode === "hybrid" &&
      !hybridAnyLinearGoalBlocksTimemaps(planClientGoals, allocatorGoalWindowMode),
    [allocatorGoalWindowMode, planClientGoals]
  );

  const railBundles = useGoalGroupRailBundles({
    isoWeekStartsMs: isoWeekStartsForRolling,
    timezone,
    nowMs,
    perfectWeekStatsBySlice
  });
  const fallbackGaps = railBundles[0]?.gaps ?? [];
  const fallbackMinutes = railBundles[0]?.minutes ?? {};

  return (
    <>
      <OvercommittedForActiveSlices
        isoWeekStartsMs={isoWeekStartsForRolling}
        timezone={timezone}
        nowMs={nowMs}
        perfectWeekStatsBySlice={perfectWeekStatsBySlice}
      />
      <ResizableColumns
        left={
          <div className="flex flex-col gap-5">
            <PlanClient
              initialGoals={planClientGoals}
              gymTemplate={gymTemplate}
              initialDeletedGoals={planClientDeletedGoals}
              perfectWeekStatsBySlice={[...perfectWeekStatsBySlice]}
              rollingSevenDayApprox={rollingSevenDayApprox}
              isoWeekStartsMsForRolling={[...isoWeekStartsForRolling]}
              calendarWeekStartsMs={[...calendarWeekStartsMs]}
              timezone={timezone}
              wheelAreas={[...(wheelAreas ?? [])]}
              goalGroupTitles={goalGroupTitles}
              goalGroups={goalGroups}
              goalIdsWithDaySheetHistory={goalIdsWithDaySheetHistory}
              rollingAsOfMs={nowMs}
              allocatorGoalWindowMode={allocatorGoalWindowMode}
            />
            <NotScheduledForActiveSlices
              isoWeekStartsMs={isoWeekStartsForRolling}
              timezone={timezone}
              nowMs={nowMs}
              perfectWeekStatsBySlice={perfectWeekStatsBySlice}
            />
          </div>
        }
        right={
          <div className="lg:sticky lg:top-6 lg:self-start">
            <div className="hidden lg:block">
              <RangeToggleCalendar
                weekStartMs={weekStartMsView}
                calendarWeekStartsMs={[...calendarWeekStartsMs]}
                previewWeekLabels={previewWeekLabels}
                timezone={timezone}
                busy={busyForCalendar}
                daySheetGoalBusy={daySheetGoalBusyForCalendar}
                system={systemBlocksForCalendar}
                proposed={proposedForCalendar}
                compact
                schedulingGoals={schedulingGoals}
                ribbonLaneOrderingGoals={ribbonLaneOrderingGoals}
                frameworkSystem={frameworkSystem}
                wheelAreas={wheelAreas}
                goalGroups={goalGroups}
                goalGroupBundles={railBundles}
                fallbackGoalGroupGaps={fallbackGaps}
                fallbackGoalGroupMinutes={fallbackMinutes}
                hasUserDragGoalOverrides={hasUserDragGoalOverrides}
                stackedTimemapRibbonsAboveProposedGoals={stackedTimemapRibbonsAboveProposedGoals}
                allocatorGoalWindowMode={allocatorGoalWindowMode}
              />
            </div>
            <details className="card lg:hidden" open>
              <summary className="cursor-pointer text-sm font-semibold">Preview this week</summary>
              <div className="mt-3">
                <RangeToggleCalendar
                  weekStartMs={weekStartMsView}
                  calendarWeekStartsMs={[...calendarWeekStartsMs]}
                  previewWeekLabels={previewWeekLabels}
                  timezone={timezone}
                  busy={busyForCalendar}
                  daySheetGoalBusy={daySheetGoalBusyForCalendar}
                  system={systemBlocksForCalendar}
                  proposed={proposedForCalendar}
                  schedulingGoals={schedulingGoals}
                  ribbonLaneOrderingGoals={ribbonLaneOrderingGoals}
                  frameworkSystem={frameworkSystem}
                  wheelAreas={wheelAreas}
                  goalGroups={goalGroups}
                  goalGroupBundles={railBundles}
                  fallbackGoalGroupGaps={fallbackGaps}
                  fallbackGoalGroupMinutes={fallbackMinutes}
                  hasUserDragGoalOverrides={hasUserDragGoalOverrides}
                  stackedTimemapRibbonsAboveProposedGoals={stackedTimemapRibbonsAboveProposedGoals}
                  allocatorGoalWindowMode={allocatorGoalWindowMode}
                />
              </div>
            </details>
          </div>
        }
      />
    </>
  );
}
