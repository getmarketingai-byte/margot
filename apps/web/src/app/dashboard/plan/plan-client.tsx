"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent
} from "react";
import type { GoalGroup, GymSettings, TrashedGoalEntry, WeeklyGoal } from "@calendar-automations/schema";
import {
  isInvertedTimemapGoal,
  normalisePlacementIdealClockBoundary,
  normalisePlacementIdealClockFilter
} from "@calendar-automations/schema";
import Link from "next/link";
import {
  STARTER_GOALS,
  aggregateGroupConstraintSummariesForGoal,
  chipsForGoal,
  goalAllocationRowDisplay,
  goalPlannerPercentOfSchedulableWeek,
  goalExceedsDeclaredWeekShare,
  summaryChipsForGoal,
  formatMinutes,
  summariseAllocation,
  type GoalAllocationRowDisplay,
  type GoalAllocationRowSummary,
  type GoalPlanMinutes
} from "./goal-helpers";
import { useDebouncedIdleRouterRefresh } from "@/hooks/useDebouncedIdleRouterRefresh";
import { goalColorFromKey } from "@/lib/goal-colors";
import { GOAL_FOCUS_EVENT, type GoalFocusDetail } from "@/lib/goal-focus";
import { measureServerAck, reportPerceivedInteraction } from "@/lib/ui-perf";
import { planOwnedPhysicalActivitySkeleton } from "@calendar-automations/planner";
import { addGoal, removeGoal, reorderGoals, restoreGoalFromTrash, updateGoal } from "./actions";
import {
  ConstraintCard,
  DurationField,
  IdealClockTimesField,
  IdealPlacementClockAfterField,
  IdealPlacementClockBeforeField,
  normaliseIdealClockTimes,
  SessionsPerWeekField,
  WeekdayToggleGrid
} from "@/components/scheduling-constraints";
import { usePlanCalendarView } from "./plan-calendar-view-context";
import type { PerfectWeekSliceStats, RollingSevenDayApprox } from "./perfect-week-stats-types";
import {
  rollingSevenDayWindowBounds,
  rollingSpansTwoIsoWeeks,
  touchedSliceIndexesForRollingWindow
} from "@/lib/rolling-seven-day-plan-stats";

type GoalDraft = Omit<WeeklyGoal, "id" | "title">;
type GoalInput = Omit<WeeklyGoal, "id">;

/** Overlay allocator Pass‑2 hints so fair-share checks match `goalsForAllocation` (wheel, floors, etc.). */
function mergeAllocatorRemainderHints<T extends { remainderHintByGoalId: Record<string, number> }>(
  summ: T,
  hints: Record<string, number> | undefined
): T {
  if (!hints || Object.keys(hints).length === 0) return summ;
  return {
    ...summ,
    remainderHintByGoalId: { ...summ.remainderHintByGoalId, ...hints }
  };
}

interface WheelOption {
  id: string;
  label: string;
}

type PaceStatus = "ahead" | "on-track" | "behind" | "no-data";

interface GoalPaceInfo {
  status: PaceStatus;
  deltaMinutes: number;
  actualMinutes: number;
  /** Pro-rated weekly target through the current weekday (pace baseline). */
  targetToDateMinutes?: number;
}

interface PlanClientProps {
  initialGoals: WeeklyGoal[];
  /** Defaults for the Physical activity (gym) quick-add button. */
  gymTemplate: GymSettings;
  /** Per ISO week allocator metrics (Perfect Week horizon) */
  perfectWeekStatsBySlice: PerfectWeekSliceStats[];
  /** Rolling-window approximation for “next 7 days · combined” */
  rollingSevenDayApprox: RollingSevenDayApprox;
  /** Week Monday ms values used for touched-slice rolling math (typically `weekSlices.map`) */
  isoWeekStartsMsForRolling: readonly number[];
  calendarWeekStartsMs: readonly number[];
  timezone: string;
  wheelAreas: WheelOption[];
  /** Map goal-group id → title (from `WeeklyPlan.goalGroups`). */
  goalGroupTitles?: Record<string, string>;
  /** Cohort definitions; used to show ∑ aggregate rules on each goal row. */
  goalGroups?: readonly GoalGroup[];
  /** Soft-deleted goals (restore within 7 days). */
  initialDeletedGoals: TrashedGoalEntry[];
  /**
   * Server wall time used when deriving {@link rollingSevenDayApprox}; keeps slice/window picks
   * aligned with serialized stats until the next navigation/refresh.
   */
  rollingAsOfMs: number;
  /**
   * Goal ids that appear on any day-sheet slot (historical). Used to widen the trash
   * warning beyond this week&apos;s `loggedMinutes` tally.
   */
  goalIdsWithDaySheetHistory?: readonly string[];
}

/** Must match {@link GOAL_TRASH_RETENTION_MS} in `@/lib/weekly-plan-trash`. */
const GOAL_TRASH_RETENTION_MS_CLIENT = 7 * 24 * 60 * 60 * 1000;

function formatTrashPurgeCountdown(deletedAtMs: number): string {
  const end = deletedAtMs + GOAL_TRASH_RETENTION_MS_CLIENT;
  const left = end - Date.now();
  if (left <= 0) return "Purging soon";
  const hours = Math.ceil(left / (60 * 60 * 1000));
  if (hours >= 48) return `Purges in ${Math.ceil(hours / 24)} days`;
  if (hours >= 1) return `Purges in about ${hours} hours`;
  const mins = Math.max(1, Math.ceil(left / (60 * 1000)));
  return `Purges in about ${mins} minutes`;
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path
        d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a2 2 0 01-2 2H8a2 2 0 01-2-2V6h12zM10 11v6M14 11v6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function emptyDraft(): GoalDraft {
  return {
    energyMode: "neutral",
    energyPolarity: "neutral",
    attentionMode: "unspecified",
    workLayer: "unspecified",
    ppfHorizon: "unspecified",
    commitmentLevel: "committed"
  };
}

function ensureGoalShape(input: GoalInput): GoalInput {
  return {
    ...input,
    energyMode: input.energyMode ?? "neutral",
    energyPolarity: input.energyPolarity ?? "neutral",
    attentionMode: input.attentionMode ?? "unspecified",
    workLayer: input.workLayer ?? "unspecified",
    ppfHorizon: input.ppfHorizon ?? "unspecified",
    commitmentLevel: input.commitmentLevel ?? "committed"
  };
}

export function PlanClient({
  initialGoals,
  gymTemplate,
  initialDeletedGoals,
  perfectWeekStatsBySlice,
  rollingSevenDayApprox,
  isoWeekStartsMsForRolling,
  calendarWeekStartsMs,
  timezone,
  wheelAreas,
  goalGroupTitles,
  goalGroups = [],
  goalIdsWithDaySheetHistory = [],
  rollingAsOfMs
}: PlanClientProps) {
  const { rangeMode, previewWeekIdx, rollingStatsMode } = usePlanCalendarView();
  const scheduleStaleDataRefresh = useDebouncedIdleRouterRefresh(850);
  const [goals, setGoals] = useState<WeeklyGoal[]>(initialGoals);
  const [deletedGoals, setDeletedGoals] = useState<TrashedGoalEntry[]>(initialDeletedGoals);
  const [pendingTrash, setPendingTrash] = useState<WeeklyGoal | null>(null);
  const trashDialogRef = useRef<HTMLDialogElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ goalId: string; nonce: number } | null>(null);
  const [, startTransition] = useTransition();

  const historyGoalIdSet = useMemo(
    () => new Set(goalIdsWithDaySheetHistory),
    [goalIdsWithDaySheetHistory]
  );

  // Keep local state synced if the server re-renders with different props
  // (e.g. user navigates away and back). We compare by ids+length to avoid
  // stomping in-progress edits when the props are equivalent.
  const lastSeenSignature = useRef<string>("");
  useEffect(() => {
    const sig = initialGoals.map((g) => g.id).join("|");
    if (sig !== lastSeenSignature.current) {
      lastSeenSignature.current = sig;
      setGoals(initialGoals);
    }
  }, [initialGoals]);

  const lastDeletedSig = useRef<string>("");
  useEffect(() => {
    const sig = initialDeletedGoals.map((e) => `${e.goal.id}:${e.deletedAtMs}`).join("|");
    if (sig !== lastDeletedSig.current) {
      lastDeletedSig.current = sig;
      setDeletedGoals(initialDeletedGoals);
    }
  }, [initialDeletedGoals]);

  useEffect(() => {
    const onFocusGoal = (event: Event) => {
      const detail = (event as CustomEvent<GoalFocusDetail>).detail;
      if (!detail?.goalId) return;
      setFocusRequest({ goalId: detail.goalId, nonce: Date.now() });
    };
    window.addEventListener(GOAL_FOCUS_EVENT, onFocusGoal);
    return () => window.removeEventListener(GOAL_FOCUS_EVENT, onFocusGoal);
  }, []);

  const isoWeekStarts =
    isoWeekStartsMsForRolling.length > 0 ? isoWeekStartsMsForRolling : calendarWeekStartsMs;
  const sliceCount = Math.max(1, perfectWeekStatsBySlice.length);
  const safeWeekIdx = Math.min(previewWeekIdx, sliceCount - 1);
  const slices = perfectWeekStatsBySlice;
  const ws0 = isoWeekStarts[0];
  const touchedRollingSliceIdx = useMemo(() => {
    if (isoWeekStarts.length === 0) return [];
    const w = isoWeekStarts[0]!;
    const { windowStartMs, windowEndMs } = rollingSevenDayWindowBounds(w, timezone, rollingAsOfMs);
    return [...new Set(touchedSliceIndexesForRollingWindow(isoWeekStarts, windowStartMs, windowEndMs))]
      .filter((i) => i >= 0 && i < slices.length)
      .sort((a, b) => a - b);
  }, [isoWeekStarts, rollingAsOfMs, slices.length, timezone]);

  const rollingSplitPairIdx =
    rangeMode === "next-7-days" &&
    rollingStatsMode === "split" &&
    ws0 !== undefined &&
    rollingSpansTwoIsoWeeks(ws0, timezone, rollingAsOfMs) &&
    touchedRollingSliceIdx.length >= 2
      ? ([touchedRollingSliceIdx[0]!, touchedRollingSliceIdx[1]!] as const)
      : null;

  const splitSliceA =
    rollingSplitPairIdx !== null ? slices[rollingSplitPairIdx[0]!] : undefined;
  const splitSliceB =
    rollingSplitPairIdx !== null ? slices[rollingSplitPairIdx[1]!] : undefined;
  const rollingSplitsTwoISO = Boolean(splitSliceA && splitSliceB);

  const summaryIsoSingle = useMemo(
    () => summariseAllocation(goals, slices[safeWeekIdx]?.freeMinutesThisWeek ?? 0),
    [goals, slices, safeWeekIdx]
  );

  const summaryRollingCombined = useMemo(
    () => summariseAllocation(goals, rollingSevenDayApprox.freeBeforeGoalsApproxMinutes),
    [goals, rollingSevenDayApprox.freeBeforeGoalsApproxMinutes]
  );

  /** ISO slice 0 free minutes — same cohort as server `effectiveTargetBaselineByGoalId` (slice 0). */
  const summaryIsoSlice0 = useMemo(
    () => summariseAllocation(goals, slices[0]?.freeMinutesThisWeek ?? 0),
    [goals, slices]
  );

  const summarySplitLeft = useMemo(
    () => summariseAllocation(goals, splitSliceA?.freeMinutesThisWeek ?? 0),
    [goals, splitSliceA?.freeMinutesThisWeek]
  );
  const summarySplitRight = useMemo(
    () => summariseAllocation(goals, splitSliceB?.freeMinutesThisWeek ?? 0),
    [goals, splitSliceB?.freeMinutesThisWeek]
  );

  /** Rolling view targets still come from ISO week slice 0 — share checks must use the same `T`. */
  const cohortAllocationSummary = useMemo((): GoalAllocationRowSummary => {
    if (rangeMode === "calendar-week") {
      return mergeAllocatorRemainderHints(
        summaryIsoSingle as GoalAllocationRowSummary,
        slices[safeWeekIdx]?.allocatorRemainderHintByGoalId
      );
    }
    if (rollingSplitsTwoISO) {
      return mergeAllocatorRemainderHints(
        summarySplitLeft as GoalAllocationRowSummary,
        splitSliceA?.allocatorRemainderHintByGoalId
      );
    }
    return mergeAllocatorRemainderHints(
      summaryIsoSlice0 as GoalAllocationRowSummary,
      slices[0]?.allocatorRemainderHintByGoalId
    );
  }, [
    rangeMode,
    rollingSplitsTwoISO,
    safeWeekIdx,
    slices,
    splitSliceA,
    summaryIsoSingle,
    summaryIsoSlice0,
    summarySplitLeft
  ]);

  const mergedPlanMinuteForTrash = useCallback(
    (goalId: string) => {
      if (rangeMode === "calendar-week") {
        return slices[safeWeekIdx]?.planMinutesByGoal[goalId]?.loggedMinutes ?? 0;
      }
      if (rollingSplitsTwoISO && splitSliceA && splitSliceB && rollingSplitPairIdx) {
        const [ia, ib] = rollingSplitPairIdx;
        const a = slices[ia]?.planMinutesByGoal[goalId]?.loggedMinutes ?? 0;
        const b = slices[ib]?.planMinutesByGoal[goalId]?.loggedMinutes ?? 0;
        return a + b;
      }
      return rollingSevenDayApprox.loggedMinutesByGoalIdInWindow[goalId] ?? 0;
    },
    [
      rangeMode,
      rollingSplitsTwoISO,
      rollingSplitPairIdx,
      safeWeekIdx,
      splitSliceA,
      splitSliceB,
      slices,
      rollingSevenDayApprox.loggedMinutesByGoalIdInWindow
    ]
  );

  const combinedRollingPlanMinute = useCallback(
    (goalId: string) => {
      const proposedWin = rollingSevenDayApprox.proposedMinutesByGoalId[goalId] ?? 0;
      const loggedWin = rollingSevenDayApprox.loggedMinutesByGoalIdInWindow[goalId] ?? 0;
      return { loggedMinutes: loggedWin, proposedFutureMinutes: proposedWin };
    },
    [rollingSevenDayApprox.loggedMinutesByGoalIdInWindow, rollingSevenDayApprox.proposedMinutesByGoalId]
  );

  const goalRowPropsFor = useCallback(
    (goalId: string) => {
      if (rangeMode === "calendar-week") {
        const sl = slices[safeWeekIdx]!;
        return {
          allocationSummary: summaryIsoSingle as GoalAllocationRowSummary,
          planMinutes: sl.planMinutesByGoal[goalId],
          effectiveTarget: sl.effectiveTargetByGoal[goalId],
          shareCheckDaySheetLoggedMinutes: sl.planMinutesByGoal[goalId]?.loggedMinutes ?? 0,
          shareAllocatorDemandBeforePass3:
            sl.demandBeforePass3ByGoal[goalId] ?? sl.effectiveTargetByGoal[goalId] ?? 0,
          pace: sl.paceByGoal[goalId] as GoalPaceInfo | undefined,
          dualWeek: undefined as
            | {
                summaries: readonly [GoalAllocationRowSummary, GoalAllocationRowSummary];
                slices: readonly [PerfectWeekSliceStats, PerfectWeekSliceStats];
              }
            | undefined
        };
      }
      if (rollingSplitsTwoISO && splitSliceA && splitSliceB && rollingSplitPairIdx) {
        return {
          allocationSummary: summarySplitLeft,
          dualWeek: {
            summaries: [summarySplitLeft, summarySplitRight] as const,
            slices: [splitSliceA, splitSliceB] as const
          },
          planMinutes: undefined,
          effectiveTarget: undefined,
          shareCheckDaySheetLoggedMinutes: 0,
          shareAllocatorDemandBeforePass3: 0,
          pace: undefined
        };
      }
      const base = rollingSevenDayApprox.effectiveTargetBaselineByGoalId[goalId] ?? 0;
      const shareCheckLogged = slices[0]?.planMinutesByGoal[goalId]?.loggedMinutes ?? 0;
      const shareDemand =
        rollingSevenDayApprox.weeklyDemandBeforePass3BaselineByGoalId[goalId] ?? base;
      return {
        allocationSummary: summaryRollingCombined as GoalAllocationRowSummary,
        planMinutes: combinedRollingPlanMinute(goalId),
        effectiveTarget: base,
        shareCheckDaySheetLoggedMinutes: shareCheckLogged,
        shareAllocatorDemandBeforePass3: shareDemand,
        pace: undefined as GoalPaceInfo | undefined,
        dualWeek: undefined
      };
    },
    [
      combinedRollingPlanMinute,
      rangeMode,
      rollingSevenDayApprox.effectiveTargetBaselineByGoalId,
      rollingSevenDayApprox.weeklyDemandBeforePass3BaselineByGoalId,
      rollingSplitsTwoISO,
      rollingSplitPairIdx,
      safeWeekIdx,
      splitSliceA,
      splitSliceB,
      slices,
      summaryIsoSingle,
      summaryRollingCombined,
      summarySplitLeft,
      summarySplitRight
    ]
  );

  const wheelLabel = useCallback(
    (id: string) => wheelAreas.find((a) => a.id === id)?.label ?? id,
    [wheelAreas]
  );

  const handleAdd = (title: string, draft: GoalDraft) => {
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: WeeklyGoal = {
      id: tempId,
      title,
      ...draft,
      energyMode: draft.energyMode ?? "neutral",
      energyPolarity: draft.energyPolarity ?? "neutral",
      attentionMode: draft.attentionMode ?? "unspecified",
      workLayer: draft.workLayer ?? "unspecified",
      ppfHorizon: draft.ppfHorizon ?? "unspecified",
      commitmentLevel: draft.commitmentLevel ?? "committed"
    };
    setGoals((prev) => [...prev, optimistic]);
    const actionId = `goal-add-${tempId}`;
    reportPerceivedInteraction("goal_add", actionId);
    const payload = ensureGoalShape({ title, ...draft });
    startTransition(async () => {
      const t0 = typeof performance !== "undefined" ? performance.now() : 0;
      try {
        const { id } = await addGoal(payload);
        setGoals((prev) => prev.map((g) => (g.id === tempId ? { ...g, id } : g)));
        measureServerAck(actionId, t0);
        scheduleStaleDataRefresh();
      } catch (err) {
        console.error("addGoal failed", err);
        setGoals((prev) => prev.filter((g) => g.id !== tempId));
      }
    });
  };

  const handleAddPhysicalActivity = () => {
    if (goals.some((g) => g.specialGoalType === "gym")) return;
    const sk = planOwnedPhysicalActivitySkeleton(gymTemplate);
    const { title, ...draftFields } = sk;
    handleAdd(title, draftFields as GoalDraft);
  };

  const handleUpdate = (id: string, next: GoalInput) => {
    const actionId = `goal-update-${id}-${crypto.randomUUID().slice(0, 8)}`;
    reportPerceivedInteraction("goal_update", actionId);
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, ...next, id } : g)));
    startTransition(async () => {
      const t0 = typeof performance !== "undefined" ? performance.now() : 0;
      try {
        await updateGoal(id, ensureGoalShape(next));
        measureServerAck(actionId, t0);
        scheduleStaleDataRefresh();
      } catch (err) {
        console.error("updateGoal failed", err);
      }
    });
  };

  useEffect(() => {
    const d = trashDialogRef.current;
    if (!d) return;
    if (pendingTrash) {
      if (!d.open) d.showModal();
    } else if (d.open) {
      d.close();
    }
  }, [pendingTrash]);

  const performTrash = (goal: WeeklyGoal) => {
    const id = goal.id;
    const actionId = `goal-delete-${id}`;
    reportPerceivedInteraction("goal_delete", actionId);
    const snapshotGoals = goals;
    const snapshotDeleted = deletedGoals;
    setGoals((prev) => prev.filter((g) => g.id !== id));
    setDeletedGoals((prev) => [...prev, { goal, deletedAtMs: Date.now() }]);
    startTransition(async () => {
      const t0 = typeof performance !== "undefined" ? performance.now() : 0;
      try {
        await removeGoal(id);
        measureServerAck(actionId, t0);
        scheduleStaleDataRefresh();
      } catch (err) {
        console.error("removeGoal failed", err);
        setGoals(snapshotGoals);
        setDeletedGoals(snapshotDeleted);
      }
    });
  };

  const handleRestoreFromTrash = (id: string) => {
    const entry = deletedGoals.find((e) => e.goal.id === id);
    if (!entry) return;
    const actionId = `goal-restore-${id}`;
    reportPerceivedInteraction("goal_restore", actionId);
    const snapshotGoals = goals;
    const snapshotDeleted = deletedGoals;
    setDeletedGoals((prev) => prev.filter((e) => e.goal.id !== id));
    setGoals((prev) => [...prev, entry.goal]);
    startTransition(async () => {
      const t0 = typeof performance !== "undefined" ? performance.now() : 0;
      try {
        await restoreGoalFromTrash(id);
        measureServerAck(actionId, t0);
        scheduleStaleDataRefresh();
      } catch (err) {
        console.error("restoreGoalFromTrash failed", err);
        setGoals(snapshotGoals);
        setDeletedGoals(snapshotDeleted);
      }
    });
  };

  const handleReorder = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const actionId = `goal-reorder-${fromIdx}-${toIdx}-${crypto.randomUUID().slice(0, 6)}`;
    reportPerceivedInteraction("goal_reorder", actionId);
    const next = [...goals];
    const [moved] = next.splice(fromIdx, 1);
    if (!moved) return;
    next.splice(toIdx, 0, moved);
    setGoals(next);
    const ids = next.map((g) => g.id);
    startTransition(async () => {
      const t0 = typeof performance !== "undefined" ? performance.now() : 0;
      try {
        await reorderGoals(ids);
        measureServerAck(actionId, t0);
        scheduleStaleDataRefresh();
      } catch (err) {
        console.error("reorderGoals failed", err);
      }
    });
  };

  const isoSliceActive = slices[safeWeekIdx];

  return (
    <div className="flex flex-col gap-5">
      {rangeMode === "calendar-week" ? (
        <BudgetChip
          summary={summaryIsoSingle}
          capacityBreakdown={isoSliceActive?.capacityBreakdown}
          weekCapacityFromNowMinutes={isoSliceActive?.weekCapacityFromNowMinutes}
          remainingWeekMinutes={isoSliceActive?.remainingWeekMinutes}
          remainingFromNowMinutes={isoSliceActive?.remainingFromNowMinutes}
          hasAnyGoalGroupMembership={summaryIsoSingle.hasAnyGoalGroupMembership}
          sectionSubtitle={isoSliceActive ? `Planning window · ${isoSliceActive.weekLabel}` : undefined}
        />
      ) : rollingSplitsTwoISO && splitSliceA && splitSliceB ? (
        <div className="flex flex-col gap-4">
          <BudgetChip
            summary={summarySplitLeft}
            capacityBreakdown={splitSliceA.capacityBreakdown}
            weekCapacityFromNowMinutes={splitSliceA.weekCapacityFromNowMinutes}
            remainingWeekMinutes={splitSliceA.remainingWeekMinutes}
            remainingFromNowMinutes={splitSliceA.remainingFromNowMinutes}
            hasAnyGoalGroupMembership={summarySplitLeft.hasAnyGoalGroupMembership}
            sectionSubtitle={`${splitSliceA.weekLabel} — ISO week (rolling split)`}
          />
          <BudgetChip
            summary={summarySplitRight}
            capacityBreakdown={splitSliceB.capacityBreakdown}
            weekCapacityFromNowMinutes={splitSliceB.weekCapacityFromNowMinutes}
            remainingWeekMinutes={splitSliceB.remainingWeekMinutes}
            remainingFromNowMinutes={splitSliceB.remainingFromNowMinutes}
            hasAnyGoalGroupMembership={summarySplitRight.hasAnyGoalGroupMembership}
            sectionSubtitle={`${splitSliceB.weekLabel} — ISO week (rolling split)`}
          />
        </div>
      ) : (
        <BudgetChip
          summary={summaryRollingCombined}
          weekCapacityFromNowMinutes={rollingSevenDayApprox.freeBeforeGoalsApproxMinutes}
          remainingWeekMinutes={rollingSevenDayApprox.freeAfterGoalsApproxMinutes}
          remainingFromNowMinutes={rollingSevenDayApprox.freeAfterGoalsApproxMinutes}
          hasAnyGoalGroupMembership={summaryRollingCombined.hasAnyGoalGroupMembership}
          approxRollingNote="Approx. for the calendar’s seven-day strip: free time merges busy/system/day-sheet layers. Logged time and proposed blocks are counted only inside this window; weekly `/wk` target is from your current ISO week."
        />
      )}

      {goals.length === 0 ? (
        <EmptyState
          onAdd={handleAdd}
          onAddPhysicalActivity={handleAddPhysicalActivity}
          physicalActivityDisabled={goals.some((g) => g.specialGoalType === "gym")}
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Goals">
          {goals.map((goal, idx) => {
            const gpr = goalRowPropsFor(goal.id);
            return (
            <GoalRow
              key={goal.id}
              goal={goal}
              index={idx}
              total={goals.length}
              wheelAreas={wheelAreas}
              wheelLabel={wheelLabel}
              allocationSummary={gpr.allocationSummary}
              shareCheckSummary={cohortAllocationSummary}
              dualWeek={gpr.dualWeek}
              planMinutes={gpr.planMinutes}
              effectiveTarget={gpr.effectiveTarget}
              shareCheckDaySheetLoggedMinutes={gpr.shareCheckDaySheetLoggedMinutes ?? 0}
              shareAllocatorDemandBeforePass3={gpr.shareAllocatorDemandBeforePass3}
              pace={gpr.pace}
              onUpdate={(next) => handleUpdate(goal.id, next)}
              onRequestTrash={() => setPendingTrash(goal)}
              onMoveUp={() => handleReorder(idx, Math.max(0, idx - 1))}
              onMoveDown={() => handleReorder(idx, Math.min(goals.length - 1, idx + 1))}
              onDropAt={(fromIdx, toIdx) => handleReorder(fromIdx, toIdx)}
              focusedGoalId={focusRequest?.goalId}
              focusNonce={focusRequest?.nonce}
              goalGroupTitles={goalGroupTitles}
              goalGroups={goalGroups}
            />
          );
          })}
          <li className="list-none flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <div className="min-w-0 flex-1">
              <AddGoalTitle onAdd={handleAdd} />
            </div>
            <button
              type="button"
              onClick={handleAddPhysicalActivity}
              disabled={goals.some((g) => g.specialGoalType === "gym")}
              title={
                goals.some((g) => g.specialGoalType === "gym")
                  ? "You already have a Physical activity row"
                  : "Add a gym-type row (drive padding, same constraints as other goals)"
              }
              className="btn-secondary h-fit shrink-0 self-stretch px-3 py-2 text-xs sm:self-auto sm:py-0"
            >
              + Physical activity
            </button>
          </li>
        </ul>
      )}

      {deletedGoals.length > 0 ? (
        <section className="card flex flex-col gap-2" aria-label="Trash">
          <h2 className="text-sm font-semibold">Trash</h2>
          <p className="text-xs text-ink-500 dark:text-ink-400">
            Deleted goals stay here for 7 days. Restore to bring a goal back (day-sheet entries tied
            to it start counting again). After 7 days they are removed permanently, including related
            day-sheet logs.
          </p>
          <ul className="flex flex-col gap-2">
            {deletedGoals.map((entry) => (
              <li
                key={entry.goal.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink-200 px-3 py-2 dark:border-ink-600"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{entry.goal.title}</div>
                  <div className="text-[11px] text-ink-500 dark:text-ink-400">
                    {formatTrashPurgeCountdown(entry.deletedAtMs)}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-secondary shrink-0 text-xs"
                  onClick={() => handleRestoreFromTrash(entry.goal.id)}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <dialog
        ref={trashDialogRef}
        className="w-[min(100%,24rem)] rounded-lg border border-ink-200 bg-white p-4 shadow-xl dark:border-ink-600 dark:bg-ink-900"
        onClose={() => setPendingTrash(null)}
      >
        {pendingTrash ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">Move goal to trash?</h2>
            <p className="text-xs leading-relaxed text-ink-600 dark:text-ink-300">
              <strong>{pendingTrash.title}</strong> will be removed from your active goals. It stays
              in Trash for 7 days so you can restore it.
            </p>
            <p className="text-xs leading-relaxed text-ink-600 dark:text-ink-300">
              While it&apos;s trashed, time logged on your day sheets for this goal won&apos;t count
              toward your plan. If you don&apos;t restore it within 7 days, those day-sheet entries
              are deleted permanently.
            </p>
            {((mergedPlanMinuteForTrash(pendingTrash.id) ?? 0) > 0 ||
              historyGoalIdSet.has(pendingTrash.id)) && (
              <p
                className="rounded-md border border-amber-300/50 bg-amber-500/10 px-2 py-2 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-500/15 dark:text-amber-100"
                role="status"
              >
                This goal has logged time on your day sheets — that time will stop counting until
                you restore the goal, and will be erased if the goal expires from Trash.
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setPendingTrash(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => {
                  performTrash(pendingTrash);
                  setPendingTrash(null);
                }}
              >
                Move to trash
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}

/* ─────────────────────────── Budget chip ─────────────────────────────────── */

function BudgetChip({
  summary,
  capacityBreakdown,
  weekCapacityFromNowMinutes,
  remainingWeekMinutes,
  remainingFromNowMinutes,
  hasAnyGoalGroupMembership,
  sectionSubtitle,
  approxRollingNote
}: {
  summary: ReturnType<typeof summariseAllocation>;
  capacityBreakdown?: PerfectWeekSliceStats["capacityBreakdown"];
  weekCapacityFromNowMinutes?: number;
  remainingWeekMinutes?: number;
  remainingFromNowMinutes?: number;
  hasAnyGoalGroupMembership?: boolean;
  sectionSubtitle?: string;
  approxRollingNote?: string;
}) {
  if (summary.goalCount === 0) {
    return (
      <div className="card flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-400">Available time this week</div>
          <div className="text-lg font-semibold">{formatMinutes(summary.freeMinutes)}</div>
        </div>
        <div className="text-sm text-ink-400">Add a goal to start filling it.</div>
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-3">
      {sectionSubtitle ? (
        <p className="text-[11px] font-medium text-ink-600 dark:text-ink-300">{sectionSubtitle}</p>
      ) : null}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Available time (week)" value={formatMinutes(summary.freeMinutes)} />
      <Stat
        label={
          remainingFromNowMinutes !== undefined
            ? "Remaining free (from now)"
            : remainingWeekMinutes !== undefined
              ? "Remaining free (week)"
              : "Unallocated remainder"
        }
        value={formatMinutes(
          remainingFromNowMinutes ?? remainingWeekMinutes ?? summary.remainingMinutes
        )}
      />
      <Stat label="Goals" value={String(summary.goalCount)} />
      <Stat
        label={
          summary.hasWeightedShare
            ? "Weekly split"
            : summary.equalShareGoals > 0
              ? "Each unconstrained goal (weekly target)"
              : "All goals fixed"
        }
        value={
          summary.hasWeightedShare
            ? "Weighted (% share)"
            : summary.equalShareGoals > 0
              ? `~${formatMinutes(summary.perEqualShareMinutes)}/wk`
              : `${formatMinutes(summary.reservedMinutes)} reserved`
        }
      />
    </div>
      {weekCapacityFromNowMinutes !== undefined ? (
        <p className="text-xs text-ink-500 dark:text-ink-300">
          Capacity from now (before placement): {formatMinutes(weekCapacityFromNowMinutes)}
          {remainingFromNowMinutes !== undefined
            ? ` · Remaining from now: ${formatMinutes(remainingFromNowMinutes)}`
            : ""}
          {remainingWeekMinutes !== undefined
            ? ` · Remaining in full week (includes past windows): ${formatMinutes(remainingWeekMinutes)}`
            : ""}
        </p>
      ) : null}
      {summary.allocationSharePercentOverflow ? (
        <p className="text-xs text-amber-700 dark:text-amber-300" role="status">
          Sum of &quot;% of week&quot; constraints is {summary.allocationSharePercentSum}% (over 100%).
          The planner scales these down proportionally so the week still balances; lower some
          percentages so targets match what you intend.
        </p>
      ) : null}
      {hasAnyGoalGroupMembership ? (
        <p className="text-xs text-ink-500 dark:text-ink-400">
          Weekly split hints above don&apos;t include <strong>goal-group</strong> pools (% and caps apply
          to the <strong>sum</strong> of members). Use each goal&apos;s Max column (planner target) for
          post-cohort numbers.
        </p>
      ) : null}
      {capacityBreakdown ? (
        <p className="text-xs text-ink-500 dark:text-ink-300" aria-label="Capacity breakdown">
          Week window {formatMinutes(capacityBreakdown.grossWeekMinutes)} · Blocked (calendar + system,
          merged) {formatMinutes(capacityBreakdown.busyWeekMinutes)}
          {capacityBreakdown.consistencyReservedWeekMinutes > 0
            ? ` · Consistency segments ${formatMinutes(capacityBreakdown.consistencyReservedWeekMinutes)}`
            : ""}
          {" · "}
          <span className="tabular-nums">{capacityBreakdown.busyTrueEventCount}</span> busy-tagged
          intervals in the feed
        </p>
      ) : null}
      {approxRollingNote ? (
        <p className="text-xs text-ink-500 dark:text-ink-300">{approxRollingNote}</p>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink-400">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

/** Title-only add row; time budgets and cadence live under each goal’s scheduling options. */
function AddGoalTitle({ onAdd }: { onAdd: (title: string, draft: GoalDraft) => void }) {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onAdd(trimmed, emptyDraft());
    setTitle("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <form
      onSubmit={submit}
      className="card flex flex-col gap-2 border-dashed border-ink-200 sm:flex-row sm:items-center dark:border-ink-600"
    >
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add another goal and press Enter"
        className="field min-w-0 flex-1"
        aria-label="New goal title"
      />
      <button type="submit" className="btn-primary shrink-0 text-xs">
        Add
      </button>
    </form>
  );
}

/* ─────────────────────────── Pace pill ───────────────────────────────────── */

const PACE_BG: Record<PaceStatus, string> = {
  ahead:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  "on-track":
    "bg-ink-100 text-ink-600 dark:bg-ink-900/40 dark:text-ink-200",
  behind:
    "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  "no-data":
    "bg-ink-100 text-ink-400 dark:bg-ink-900/40 dark:text-ink-400"
};

function PacePill({ pace }: { pace: GoalPaceInfo }) {
  let label: string;
  switch (pace.status) {
    case "ahead":
      label = `Ahead ${formatMinutes(pace.deltaMinutes)}`;
      break;
    case "behind":
      label = `Behind ${formatMinutes(-pace.deltaMinutes)}`;
      break;
    case "on-track":
      label = "On track";
      break;
    default:
      label = "No data";
  }
  return (
    <span
      title={
        pace.targetToDateMinutes != null
          ? `${formatMinutes(pace.actualMinutes)} vs ${formatMinutes(pace.targetToDateMinutes)} min (achieved vs pro-rated target to date)`
          : `${formatMinutes(pace.actualMinutes)} min counted for pace`
      }
      className={`rounded-full px-2 py-0.5 text-[11px] ${PACE_BG[pace.status]}`}
    >
      {label}
    </span>
  );
}

function AllocationRowPanels({ row }: { row: GoalAllocationRowDisplay }) {
  return (
    <>
      <details className="group mt-0.5 w-full shrink-0 basis-full lg:block lg:@lg:hidden">
        <summary
          className="cursor-pointer list-none text-right text-[10px] leading-none text-ink-400/90 outline-none marker:content-none [&::-webkit-details-marker]:hidden focus-visible:ring-2 focus-visible:ring-accent/40"
          title={row.title}
          aria-label={`Schedule: logged ${row.loggedLabel}, proposed ${row.proposedLabel}, min ${row.minTargetLabel}, max ${row.maxTargetLabel}. Open for labels.`}
        >
          <span className="tabular-nums">
            {row.loggedLabel}
            <span className="px-1 text-ink-300/50" aria-hidden>
              ·
            </span>
            {row.proposedLabel}
            <span className="px-1 text-ink-300/50" aria-hidden>
              ·
            </span>
            {row.minTargetLabel}
            <span className="px-1 text-ink-300/50" aria-hidden>
              ·
            </span>
            {row.maxTargetLabel}
          </span>
        </summary>
        <dl className="mt-1 space-y-0.5 text-right text-[10px] leading-snug text-ink-500 dark:text-ink-400">
          <div className="flex justify-end gap-2">
            <dt className="font-normal text-ink-400/75">Logged</dt>
            <dd className="tabular-nums text-ink-600 dark:text-ink-300">{row.loggedLabel}</dd>
          </div>
          <div className="flex justify-end gap-2">
            <dt className="font-normal text-ink-400/75">Proposed</dt>
            <dd className="tabular-nums text-ink-600 dark:text-ink-300">{row.proposedLabel}</dd>
          </div>
          <div className="flex justify-end gap-2">
            <dt className="font-normal text-ink-400/75">Min</dt>
            <dd className="tabular-nums text-ink-600 dark:text-ink-300">{row.minTargetLabel}</dd>
          </div>
          <div className="flex justify-end gap-2">
            <dt className="font-normal text-ink-400/75">Max</dt>
            <dd className="tabular-nums text-ink-600 dark:text-ink-300">{row.maxTargetLabel}</dd>
          </div>
        </dl>
      </details>
      <div
        className="mt-0.5 hidden text-ink-400 lg:ml-auto lg:mt-0 lg:@lg:flex lg:shrink-0"
        title={row.title}
      >
        <div className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5 text-[10px] leading-none text-ink-400/85 [word-spacing:-0.02em] dark:text-ink-500">
          <span className="min-w-0 whitespace-nowrap tabular-nums after:px-1 after:text-ink-300/50 after:content-['·'] last:after:content-none">
            <span className="font-normal text-ink-400/70">Logged </span>
            {row.loggedLabel}
          </span>
          <span className="min-w-0 whitespace-nowrap tabular-nums after:px-1 after:text-ink-300/50 after:content-['·'] last:after:content-none">
            <span className="font-normal text-ink-400/70">Proposed </span>
            {row.proposedLabel}
          </span>
          <span className="min-w-0 whitespace-nowrap tabular-nums after:px-1 after:text-ink-300/50 after:content-['·'] last:after:content-none">
            <span className="font-normal text-ink-400/70">Min </span>
            {row.minTargetLabel}
          </span>
          <span className="min-w-0 whitespace-nowrap tabular-nums">
            <span className="font-normal text-ink-400/70">Max </span>
            {row.maxTargetLabel}
          </span>
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────── Goal row (collapsed + expanded) ─────────────── */

function truncateCohortSummaryLine(line: string, maxChars = 44): string {
  if (line.length <= maxChars) return line;
  return `${line.slice(0, maxChars - 1).trimEnd()}…`;
}

function GoalRow({
  goal,
  index,
  total,
  wheelAreas,
  wheelLabel,
  allocationSummary,
  shareCheckSummary,
  dualWeek,
  planMinutes,
  effectiveTarget,
  shareCheckDaySheetLoggedMinutes = 0,
  shareAllocatorDemandBeforePass3,
  pace,
  onUpdate,
  onRequestTrash,
  onMoveUp,
  onMoveDown,
  onDropAt,
  focusedGoalId,
  focusNonce,
  goalGroupTitles,
  goalGroups = []
}: {
  goal: WeeklyGoal;
  index: number;
  total: number;
  wheelAreas: WheelOption[];
  wheelLabel: (id: string) => string;
  allocationSummary: GoalAllocationRowSummary;
  shareCheckSummary: GoalAllocationRowSummary;
  dualWeek?: {
    summaries: readonly [GoalAllocationRowSummary, GoalAllocationRowSummary];
    slices: readonly [PerfectWeekSliceStats, PerfectWeekSliceStats];
  };
  planMinutes?: GoalPlanMinutes;
  effectiveTarget?: number;
  /** Logged minutes on the same ISO slice as `shareCheckSummary` (cohort fair-share). */
  shareCheckDaySheetLoggedMinutes?: number;
  /** When set, fair-share compare uses this (post–log / from-now) instead of display target. */
  shareAllocatorDemandBeforePass3?: number;
  pace?: GoalPaceInfo;
  onUpdate: (next: GoalInput) => void;
  onRequestTrash: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDropAt: (fromIdx: number, toIdx: number) => void;
  focusedGoalId?: string;
  focusNonce?: number;
  goalGroupTitles?: Record<string, string>;
  goalGroups?: readonly GoalGroup[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [editTitle, setEditTitle] = useState(goal.title);
  const [draftDirty, setDraftDirty] = useState<GoalDraft | null>(null);
  const [dragOver, setDragOver] = useState<"top" | "bottom" | null>(null);
  const goalColor = goalColorFromKey(goal.id || goal.title);
  const rowRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => setEditTitle(goal.title), [goal.title]);
  useEffect(() => {
    if (!focusNonce) return;
    if (focusedGoalId !== goal.id) return;
    setExpanded(true);
    rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusNonce, focusedGoalId, goal.id]);

  const allChips = chipsForGoal(goal, wheelLabel);
  const rowChips = summaryChipsForGoal(goal, wheelLabel);
  const rowKeySet = new Set(rowChips.map((c) => c.key));
  const hiddenChips = allChips.filter((c) => !rowKeySet.has(c.key));
  const hiddenChipSummary = hiddenChips.map((c) => c.label).join(" · ");

  const draft: GoalDraft = draftDirty ?? extractDraft(goal);

  const cohortSummaries = aggregateGroupConstraintSummariesForGoal(goal, goalGroups);

  const allocationRowDual =
    dualWeek?.summaries?.[0] && dualWeek.summaries[1]
      ? (() => {
          const mk = (summ: GoalAllocationRowSummary, sl: PerfectWeekSliceStats) =>
            goalAllocationRowDisplay(
              goal,
              summ,
              sl.planMinutesByGoal[goal.id] ?? {
                loggedMinutes: 0,
                proposedFutureMinutes: 0
              },
              sl.effectiveTargetByGoal[goal.id]
            );
          return {
            a: mk(dualWeek.summaries[0], dualWeek.slices[0]),
            b: mk(dualWeek.summaries[1], dualWeek.slices[1])
          };
        })()
      : undefined;

  const allocationRow =
    allocationRowDual
      ? undefined
      : planMinutes !== undefined &&
          effectiveTarget !== undefined &&
          effectiveTarget > 0
        ? goalAllocationRowDisplay(goal, allocationSummary, planMinutes, effectiveTarget)
        : undefined;

  const shareOverBudget = allocationRowDual
    ? false
    : effectiveTarget !== undefined &&
        effectiveTarget > 0 &&
        goalExceedsDeclaredWeekShare(
          goal,
          shareCheckSummary,
          effectiveTarget,
          shareCheckDaySheetLoggedMinutes,
          shareAllocatorDemandBeforePass3
        );

  const defaultAllocationSharePercent =
    allocationSummary.equalShareGoals > 0
      ? Math.max(1, Math.min(100, Math.round(100 / allocationSummary.equalShareGoals)))
      : 40;

  const invertedTimemap = isInvertedTimemapGoal(goal);
  const schedulableWeekPercentSingle =
    !invertedTimemap && !dualWeek
      ? goalPlannerPercentOfSchedulableWeek(effectiveTarget, allocationSummary.freeMinutes)
      : null;
  const schedulableWeekPercentsDual =
    !invertedTimemap && dualWeek
      ? dualWeek.slices.map((sl) => ({
          weekLabel: sl.weekLabel,
          percent: goalPlannerPercentOfSchedulableWeek(
            sl.effectiveTargetByGoal[goal.id],
            sl.freeMinutesThisWeek
          )
        }))
      : null;
  const showSchedulableWeekShare =
    schedulableWeekPercentSingle !== null ||
    (schedulableWeekPercentsDual?.some((s) => s.percent !== null) ?? false);

  const schedulableWeekShareTitle =
    "% of full-week schedulable time (after calendar busy, sleep, travel, etc.) — same basis as “% of week” constraints. Uses this goal’s planner weekly target.";

  const commitDraft = (next: GoalDraft) => {
    setDraftDirty(next);
    onUpdate({ title: editTitle.trim() || goal.title, ...next });
  };

  const commitTitle = () => {
    const next = editTitle.trim();
    if (next && next !== goal.title) {
      onUpdate({ title: next, ...(draftDirty ?? extractDraft(goal)) });
    }
  };

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", String(index));
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isTop = e.clientY < rect.top + rect.height / 2;
    setDragOver(isTop ? "top" : "bottom");
  };
  const onDragLeave = () => setDragOver(null);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const fromIdx = Number(e.dataTransfer.getData("text/plain"));
    if (Number.isNaN(fromIdx)) return;
    const toIdx = dragOver === "top" ? index : index + 1;
    setDragOver(null);
    if (fromIdx === index || fromIdx === index + 1) return;
    // Adjust target index when dragging downward over the same item.
    const adjusted = fromIdx < toIdx ? toIdx - 1 : toIdx;
    onDropAt(fromIdx, adjusted);
  };

  return (
    <li
      ref={rowRef}
      className={`card relative flex flex-col gap-2 ${
        dragOver === "top" ? "border-t-accent border-t-2" : ""
      } ${dragOver === "bottom" ? "border-b-accent border-b-2" : ""}`}
      style={{ borderLeftColor: goalColor, borderLeftWidth: 4 }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {showSchedulableWeekShare ? (
        <div
          className="flex flex-col gap-1.5 border-b border-ink-100 pb-2 dark:border-ink-700/60"
          role="group"
          aria-label={`${goal.title}: share of schedulable week`}
        >
          {schedulableWeekPercentsDual
            ? schedulableWeekPercentsDual.map((seg, ix) =>
                seg.percent === null ? null : (
                  <div key={ix} className="flex flex-col gap-0.5">
                    <div className="text-[9px] font-medium uppercase tracking-wide text-ink-400 dark:text-ink-500">
                      {seg.weekLabel}
                    </div>
                    <div
                      className="h-1 w-full overflow-hidden rounded-full bg-ink-200/90 dark:bg-ink-700/80"
                      title={schedulableWeekShareTitle}
                    >
                      <div
                        className="h-full min-w-px rounded-full"
                        style={{
                          width: `${seg.percent}%`,
                          backgroundColor: goalColor
                        }}
                      />
                    </div>
                  </div>
                )
              )
            : schedulableWeekPercentSingle !== null ? (
                <div
                  className="h-1 w-full overflow-hidden rounded-full bg-ink-200/90 dark:bg-ink-700/80"
                  title={schedulableWeekShareTitle}
                >
                  <div
                    className="h-full min-w-px rounded-full"
                    style={{
                      width: `${schedulableWeekPercentSingle}%`,
                      backgroundColor: goalColor
                    }}
                  />
                </div>
              ) : null}
          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-[10px] tabular-nums text-ink-500 dark:text-ink-400">
            {schedulableWeekPercentsDual ? (
              schedulableWeekPercentsDual
                .filter(
                  (seg): seg is { weekLabel: string; percent: number } => seg.percent !== null
                )
                .map((seg, ix) => (
                  <span key={seg.weekLabel} title={schedulableWeekShareTitle}>
                    {ix > 0 ? (
                      <span className="pr-1.5 text-ink-300/70 dark:text-ink-600" aria-hidden>
                        ·
                      </span>
                    ) : null}
                    <span className="text-ink-400 dark:text-ink-500">{seg.weekLabel}: </span>
                    <span className="font-medium text-ink-700 dark:text-ink-200">{seg.percent}%</span>
                    <span className="text-ink-400/90"> of week</span>
                  </span>
                ))
            ) : schedulableWeekPercentSingle !== null ? (
              <span title={schedulableWeekShareTitle}>
                <span className="font-medium text-ink-700 dark:text-ink-200">
                  {schedulableWeekPercentSingle}%
                </span>
                <span className="text-ink-400/90"> of week</span>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label="Drag to reorder"
          draggable
          onDragStart={onDragStart}
          className="cursor-grab select-none px-1 text-ink-400 hover:text-ink-900 dark:hover:text-ink-100"
          tabIndex={-1}
        >
          ⋮⋮
        </button>
        <div className="@container flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left">
            <div
              role="button"
              tabIndex={0}
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpanded((v) => !v);
                }
              }}
              className="flex min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: goalColor }}
              />
              <span className="text-sm font-medium" style={{ color: goalColor }}>
                {goal.title}
              </span>
              {allocationRowDual && dualWeek ? (
                <>
                  {([0, 1] as const).map((idx) => {
                    const pc = dualWeek!.slices[idx].paceByGoal[goal.id] as GoalPaceInfo | undefined;
                    return pc?.status !== "no-data" && pc ? (
                      <PacePill key={`p-${idx}`} pace={pc} />
                    ) : null;
                  })}
                </>
              ) : pace && pace.status !== "no-data" ? (
                <PacePill pace={pace} />
              ) : null}
              {rowChips.length === 0 && hiddenChips.length === 0 && !(goal.groupIds?.length) ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-1 text-xs text-ink-400 dark:bg-ink-900/40">
                  Equal share
                  {allocationRowDual && dualWeek ? (
                    <span className="tabular-nums">
                      {dualWeek.slices
                        .map((s) => s.effectiveTargetByGoal[goal.id] ?? 0)
                        .filter((m) => m > 0)
                        .map((m) => `~${formatMinutes(m)}/wk`)
                        .join(" · ")}
                    </span>
                  ) : effectiveTarget && effectiveTarget > 0 ? (
                    ` · ~${formatMinutes(effectiveTarget)}/wk`
                  ) : (
                    ""
                  )}
                </span>
              ) : (
                <>
                  {rowChips.map((chip) => (
                    <span
                      key={chip.key}
                      className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-1 text-xs text-ink-600 dark:bg-ink-900/40 dark:text-ink-200"
                    >
                      {chip.label}
                    </span>
                  ))}
                  {hiddenChips.length > 0 ? (
                    <span
                      title={hiddenChipSummary}
                      className="inline-flex shrink-0 items-center rounded-full border border-dashed border-ink-200 px-1.5 py-0.5 text-[11px] tabular-nums text-ink-500 dark:border-ink-600 dark:text-ink-300"
                    >
                      +{hiddenChips.length}
                    </span>
                  ) : null}
                  {(goal.groupIds ?? []).map((gid) => (
                    <span
                      key={`grp-${gid}`}
                      title="Goal group — edit on Planner"
                      className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-1 text-[11px] text-accent dark:text-accent"
                    >
                      {goalGroupTitles?.[gid] ?? gid.slice(0, 8)}
                    </span>
                  ))}
                  {cohortSummaries.length > 0 ? (
                    <span
                      title={cohortSummaries.map((s) => s.line).join("\n")}
                      className="inline-flex max-w-[min(100%,16rem)] shrink-0 items-center gap-1 truncate rounded-full border border-dashed border-accent/35 bg-accent/5 px-2 py-1 text-[11px] text-accent/95 dark:border-accent/40 dark:bg-accent/10 dark:text-accent"
                    >
                      <span className="shrink-0 font-medium" aria-hidden>
                        ∑
                      </span>
                      <span className="min-w-0 truncate">
                        {truncateCohortSummaryLine(cohortSummaries[0]!.line)}
                        {cohortSummaries.length > 1
                          ? ` +${cohortSummaries.length - 1}`
                          : ""}
                      </span>
                    </span>
                  ) : null}
                </>
              )}
            </div>
            {allocationRowDual && dualWeek ? (
              <div className="mt-0.5 flex w-full flex-col gap-2">
                {([allocationRowDual.a, allocationRowDual.b] as const).map((row, ix) => (
                  <div key={dualWeek.slices[ix as 0 | 1]!.weekStartMs} className="w-full">
                    <div className="mb-0.5 text-[10px] font-medium text-ink-500 dark:text-ink-400">
                      {dualWeek.slices[ix as 0 | 1]!.weekLabel}
                    </div>
                    <AllocationRowPanels row={row} />
                  </div>
                ))}
              </div>
            ) : allocationRow ? (
              <AllocationRowPanels row={allocationRow} />
            ) : null}
          </div>
          {shareOverBudget ? (
            <p className="mt-1 text-right text-[11px] text-amber-700 dark:text-amber-300" role="status">
              Planner target is above this row&apos;s fair % of the week (or a simple even slice when
              no % is set). Check caps, catch-up, or conflicting % totals.
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <IconButton onClick={onMoveUp} disabled={index === 0} title="Move up">
            ↑
          </IconButton>
          <IconButton
            onClick={onMoveDown}
            disabled={index === total - 1}
            title="Move down"
          >
            ↓
          </IconButton>
          <IconButton onClick={onRequestTrash} title={`Move goal “${goal.title}” to trash`}>
            <TrashIcon className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-ink-200 pt-3 dark:border-ink-600">
          <label className="flex flex-col gap-1 text-xs">
            Title
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={commitTitle}
              className="field"
            />
          </label>
          <p className="mt-3 text-xs leading-relaxed text-ink-500 dark:text-ink-300">
            Framework tags (wheel, PPF pillar, attention, …),{" "}
            <strong>energy mode</strong>, and <strong>focus battery</strong> are configured on{" "}
            <Link className="font-medium text-accent underline" href="/dashboard/planner#battery-curve-goals">
              Planner
            </Link>{" "}
            so this list stays about titles and time.
          </p>
          <div className="mt-3">
            <OptionsEditor
              draft={draft}
              onChange={commitDraft}
              defaultAllocationSharePercent={defaultAllocationSharePercent}
            />
          </div>
          {cohortSummaries.length > 0 ? (
            <div
              className="mt-3 rounded-md border border-dashed border-accent/30 bg-accent/5 px-3 py-2 dark:border-accent/35 dark:bg-accent/10"
              role="region"
              aria-label="Cohort scheduling rules for this goal"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-accent/90 dark:text-accent">
                Cohort rules (sum of group members)
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-ink-600 dark:text-ink-300">
                {cohortSummaries.map((s) => (
                  <li key={s.groupId}>{s.line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </li>
  );
}

function IconButton({
  children,
  onClick,
  title,
  disabled
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-30 dark:hover:bg-ink-600/40 dark:hover:text-ink-100"
    >
      {children}
    </button>
  );
}

function extractDraft(goal: WeeklyGoal): GoalDraft {
  const draft: GoalDraft = {
    energyMode: goal.energyMode ?? "neutral",
    energyPolarity: goal.energyPolarity ?? "neutral",
    attentionMode: goal.attentionMode ?? "unspecified",
    workLayer: goal.workLayer ?? "unspecified",
    ppfHorizon: goal.ppfHorizon ?? "unspecified",
    commitmentLevel: goal.commitmentLevel ?? "committed"
  };
  if (goal.minMinutesPerWeek !== undefined) draft.minMinutesPerWeek = goal.minMinutesPerWeek;
  if (goal.maxMinutesPerWeek !== undefined) draft.maxMinutesPerWeek = goal.maxMinutesPerWeek;
  if (goal.minMinutesPerDay !== undefined) draft.minMinutesPerDay = goal.minMinutesPerDay;
  if (goal.maxMinutesPerDay !== undefined) draft.maxMinutesPerDay = goal.maxMinutesPerDay;
  if (goal.minMinutesPerBlock !== undefined) draft.minMinutesPerBlock = goal.minMinutesPerBlock;
  if (goal.maxAutoBlocksPerDay !== undefined) draft.maxAutoBlocksPerDay = goal.maxAutoBlocksPerDay;
  if (goal.frequencyPerWeek !== undefined) draft.frequencyPerWeek = goal.frequencyPerWeek;
  if (goal.daysOfWeek !== undefined) draft.daysOfWeek = goal.daysOfWeek;
  if (goal.dayOfWeek !== undefined) draft.dayOfWeek = goal.dayOfWeek;
  if (goal.wheelAreaId !== undefined) draft.wheelAreaId = goal.wheelAreaId;
  if (goal.ppfPillar !== undefined) draft.ppfPillar = goal.ppfPillar;
  if (goal.earliestHour !== undefined) draft.earliestHour = goal.earliestHour;
  if (goal.latestHour !== undefined) draft.latestHour = goal.latestHour;
  if (goal.allocationSharePercent !== undefined) draft.allocationSharePercent = goal.allocationSharePercent;
  if (goal.scheduleInNiceWeather === true) draft.scheduleInNiceWeather = true;
  if (goal.focusAffinity !== undefined) draft.focusAffinity = goal.focusAffinity;
  if (goal.energyChargeImpact !== undefined) draft.energyChargeImpact = goal.energyChargeImpact;
  if (goal.energyDrainImpact !== undefined) draft.energyDrainImpact = goal.energyDrainImpact;
  if (goal.placementIdealClockTimes !== undefined && goal.placementIdealClockTimes.length > 0) {
    draft.placementIdealClockTimes = [...goal.placementIdealClockTimes];
  }
  if (goal.placementIdealClockAfter !== undefined) {
    const na = normalisePlacementIdealClockBoundary(goal.placementIdealClockAfter);
    if (na) draft.placementIdealClockAfter = na;
  }
  if (goal.placementIdealClockBefore !== undefined) {
    const nb = normalisePlacementIdealClockBoundary(goal.placementIdealClockBefore);
    if (nb) draft.placementIdealClockBefore = nb;
  }
  if (goal.placementIdealClockFilter !== undefined) {
    const nf = normalisePlacementIdealClockFilter(goal.placementIdealClockFilter);
    if (nf) draft.placementIdealClockFilter = nf;
  }
  if (goal.specialGoalType !== undefined) draft.specialGoalType = goal.specialGoalType;
  if (goal.anchor !== undefined) draft.anchor = goal.anchor;
  return draft;
}

function draftIdealAfterBoundary(d: GoalDraft) {
  const direct = normalisePlacementIdealClockBoundary(d.placementIdealClockAfter);
  if (direct) return direct;
  const leg = normalisePlacementIdealClockFilter(d.placementIdealClockFilter);
  return leg?.kind === "after" ? { hour: leg.hour, minute: leg.minute } : undefined;
}

function draftIdealBeforeBoundary(d: GoalDraft) {
  const direct = normalisePlacementIdealClockBoundary(d.placementIdealClockBefore);
  if (direct) return direct;
  const leg = normalisePlacementIdealClockFilter(d.placementIdealClockFilter);
  return leg?.kind === "before" ? { hour: leg.hour, minute: leg.minute } : undefined;
}

function patchIdealAfter(d: GoalDraft, next: ReturnType<typeof normalisePlacementIdealClockBoundary>) {
  return {
    placementIdealClockAfter: next,
    placementIdealClockFilter:
      d.placementIdealClockFilter?.kind === "before" ? d.placementIdealClockFilter : undefined
  };
}

function patchIdealBefore(d: GoalDraft, next: ReturnType<typeof normalisePlacementIdealClockBoundary>) {
  return {
    placementIdealClockBefore: next,
    placementIdealClockFilter:
      d.placementIdealClockFilter?.kind === "after" ? d.placementIdealClockFilter : undefined
  };
}

/* ─────────────────────────── Options editor ──────────────────────────────── */

/**
 * Each constraint is opt-in: we render only the ones the user has actually
 * set, with a remove (✕) action. Unset constraints appear as "+ Add X"
 * buttons at the bottom of the editor so the surface stays small until the
 * user explicitly reaches for a constraint. This is the chip-builder pattern
 * applied to the row's editor.
 */
type ConstraintId =
  | "min-week"
  | "min-day"
  | "max-week"
  | "max-day"
  | "min-block"
  | "max-blocks-day"
  | "share-remainder"
  | "frequency"
  | "days"
  | "nice-weather"
  | "ideal-start-times"
  | "ideal-after-local"
  | "ideal-before-local";

interface ConstraintDef {
  id: ConstraintId;
  label: string;
  isSet: (d: GoalDraft) => boolean;
  initialise: (d: GoalDraft) => Partial<GoalDraft>;
  clear: (d: GoalDraft) => Partial<GoalDraft>;
}

function isDaySet(d: GoalDraft): boolean {
  return Boolean((d.daysOfWeek && d.daysOfWeek.length > 0) || d.dayOfWeek);
}

function OptionsEditor({
  draft,
  onChange,
  defaultAllocationSharePercent
}: {
  draft: GoalDraft;
  onChange: (draft: GoalDraft) => void;
  /** Equal slice as % of full-week time: round(100 / remainder-cohort size). */
  defaultAllocationSharePercent: number;
}) {
  const update = (changes: Partial<GoalDraft>) => onChange({ ...draft, ...changes });

  // Order matters: this is the order rows appear, both as set rows and as
  // "+ Add X" buttons. Time and cadence only — framework-linked signals live on Planner.
  const constraints: ConstraintDef[] = [
    {
      id: "min-week",
      label: "Min per week",
      isSet: (d) => d.minMinutesPerWeek !== undefined,
      initialise: () => ({ minMinutesPerWeek: 60 }),
      clear: () => ({ minMinutesPerWeek: undefined })
    },
    {
      id: "min-day",
      label: "Min per day",
      isSet: (d) => d.minMinutesPerDay !== undefined,
      initialise: () => ({ minMinutesPerDay: 30 }),
      clear: () => ({ minMinutesPerDay: undefined })
    },
    {
      id: "max-week",
      label: "Max per week",
      isSet: (d) => d.maxMinutesPerWeek !== undefined,
      initialise: () => ({ maxMinutesPerWeek: 300 }),
      clear: () => ({ maxMinutesPerWeek: undefined })
    },
    {
      id: "max-day",
      label: "Max per day",
      isSet: (d) => d.maxMinutesPerDay !== undefined,
      initialise: () => ({ maxMinutesPerDay: 120 }),
      clear: () => ({ maxMinutesPerDay: undefined })
    },
    {
      id: "min-block",
      label: "Min block size",
      isSet: (d) => d.minMinutesPerBlock !== undefined,
      initialise: () => ({ minMinutesPerBlock: 4 * 60 }),
      clear: () => ({ minMinutesPerBlock: undefined })
    },
    {
      id: "max-blocks-day",
      label: "Max blocks / day",
      isSet: (d) => d.maxAutoBlocksPerDay !== undefined,
      initialise: () => ({ maxAutoBlocksPerDay: 2 }),
      clear: () => ({ maxAutoBlocksPerDay: undefined })
    },
    {
      id: "share-remainder",
      label: "% of week",
      isSet: (d) => d.allocationSharePercent !== undefined,
      initialise: () => ({ allocationSharePercent: defaultAllocationSharePercent }),
      clear: () => ({ allocationSharePercent: undefined })
    },
    {
      id: "frequency",
      label: "Times per week",
      isSet: (d) => d.frequencyPerWeek !== undefined,
      initialise: () => ({ frequencyPerWeek: 3 }),
      clear: () => ({ frequencyPerWeek: undefined })
    },
    {
      id: "days",
      label: "Pin to day(s)",
      isSet: isDaySet,
      initialise: () => ({ daysOfWeek: ["monday"], dayOfWeek: undefined }),
      clear: () => ({ daysOfWeek: undefined, dayOfWeek: undefined })
    },
    {
      id: "nice-weather",
      label: "Nice weather slots",
      isSet: (d) => d.scheduleInNiceWeather === true,
      initialise: () => ({ scheduleInNiceWeather: true }),
      clear: () => ({ scheduleInNiceWeather: undefined })
    },
    {
      id: "ideal-start-times",
      label: "Ideal start times",
      isSet: (d) =>
        Array.isArray(d.placementIdealClockTimes) && d.placementIdealClockTimes.length > 0,
      initialise: () => ({
        placementIdealClockTimes: normaliseIdealClockTimes(undefined, { hour: 12, minute: 0 })
      }),
      clear: () => ({ placementIdealClockTimes: undefined })
    },
    {
      id: "ideal-after-local",
      label: "Ideal times — after",
      isSet: (d) =>
        d.placementIdealClockAfter !== undefined ||
        d.placementIdealClockFilter?.kind === "after",
      initialise: (d) => ({
        placementIdealClockAfter: { hour: 18, minute: 0 },
        placementIdealClockFilter:
          d.placementIdealClockFilter?.kind === "before" ? d.placementIdealClockFilter : undefined
      }),
      clear: (d) => ({
        placementIdealClockAfter: undefined,
        placementIdealClockFilter:
          d.placementIdealClockFilter?.kind === "before" ? d.placementIdealClockFilter : undefined
      })
    },
    {
      id: "ideal-before-local",
      label: "Ideal times — before",
      isSet: (d) =>
        d.placementIdealClockBefore !== undefined ||
        d.placementIdealClockFilter?.kind === "before",
      initialise: (d) => ({
        placementIdealClockBefore: { hour: 22, minute: 0 },
        placementIdealClockFilter:
          d.placementIdealClockFilter?.kind === "after" ? d.placementIdealClockFilter : undefined
      }),
      clear: (d) => ({
        placementIdealClockBefore: undefined,
        placementIdealClockFilter:
          d.placementIdealClockFilter?.kind === "after" ? d.placementIdealClockFilter : undefined
      })
    }
  ];

  const setConstraints = constraints.filter((c) => c.isSet(draft));
  const unsetConstraints = constraints.filter((c) => !c.isSet(draft));
  const clearAllConstraints = () => {
    const cleared = setConstraints.reduce<GoalDraft>(
      (nextDraft, constraint) => ({ ...nextDraft, ...constraint.clear(nextDraft) }),
      draft
    );
    onChange(cleared);
  };

  return (
    <div className="flex flex-col gap-3">
      {setConstraints.length === 0 ? (
        <p className="text-xs text-ink-400">
          No constraints set — this goal gets an equal share of free time. Add a constraint below
          to refine.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={clearAllConstraints}
              className="rounded-full border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:border-accent hover:text-accent dark:border-ink-600 dark:text-ink-200"
            >
              Clear constraints
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {setConstraints.map((c) => (
              <ConstraintCard
                key={c.id}
                label={c.label}
                onRemove={() => update(c.clear(draft))}
              >
                <ConstraintBody
                  id={c.id}
                  draft={draft}
                  update={update}
                  defaultAllocationSharePercent={defaultAllocationSharePercent}
                />
              </ConstraintCard>
            ))}
          </div>
        </div>
      )}

      {unsetConstraints.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-ink-200 pt-3 dark:border-ink-600">
          <span className="text-[11px] uppercase tracking-wide text-ink-400">Add constraint</span>
          <div className="flex flex-wrap gap-2">
            {unsetConstraints.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => update(c.initialise(draft))}
                className="rounded-full border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:border-accent hover:text-accent dark:border-ink-600 dark:text-ink-200"
              >
                + {c.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PercentShareField({
  value,
  onChange,
  hint,
  defaultPercent = 40
}: {
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  hint?: React.ReactNode;
  /** Slider position when value is unset (equal slice of week). */
  defaultPercent?: number;
}) {
  const clamp = (n: number) => Math.min(100, Math.max(1, Math.round(n)));
  const sliderPos = clamp(value ?? defaultPercent);

  return (
    <div className="flex flex-col gap-2 text-xs">
      <label className="flex flex-col gap-1">
        <span>Percent (1–100)</span>
        <input
          type="number"
          min={1}
          max={100}
          value={value === undefined ? "" : value}
          onChange={(e) => {
            if (e.target.value === "") {
              onChange(undefined);
              return;
            }
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            onChange(clamp(n));
          }}
          placeholder={String(defaultPercent)}
          className="field"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="sr-only">Adjust percent with a slider</span>
        <input
          type="range"
          min={1}
          max={100}
          step={1}
          value={sliderPos}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            onChange(clamp(n));
          }}
          className="h-2 w-full cursor-pointer accent-accent"
        />
      </label>
      {hint ? <span className="text-[11px] text-ink-400">{hint}</span> : null}
    </div>
  );
}

function ConstraintBody({
  id,
  draft,
  update,
  defaultAllocationSharePercent
}: {
  id: ConstraintId;
  draft: GoalDraft;
  update: (changes: Partial<GoalDraft>) => void;
  defaultAllocationSharePercent: number;
}) {
  switch (id) {
    case "min-week":
      return (
        <DurationField
          value={draft.minMinutesPerWeek}
          onChange={(v) => update({ minMinutesPerWeek: v })}
          hint="Reserved before equal share."
          sliderMinMinutes={0}
          sliderMaxMinutes={48 * 60}
        />
      );
    case "min-day":
      return (
        <DurationField
          value={draft.minMinutesPerDay}
          onChange={(v) => update({ minMinutesPerDay: v })}
          hint="Daily floor on scheduled days."
          sliderMinMinutes={0}
          sliderMaxMinutes={24 * 60}
        />
      );
    case "max-week":
      return (
        <DurationField
          value={draft.maxMinutesPerWeek}
          onChange={(v) => update({ maxMinutesPerWeek: v === undefined ? undefined : Math.max(1, v) })}
          hint="Weekly ceiling."
          sliderMinMinutes={1}
          sliderMaxMinutes={48 * 60}
        />
      );
    case "max-day":
      return (
        <DurationField
          value={draft.maxMinutesPerDay}
          onChange={(v) => update({ maxMinutesPerDay: v === undefined ? undefined : Math.max(1, v) })}
          hint="Daily cap so this doesn't dominate a day."
          sliderMinMinutes={1}
          sliderMaxMinutes={24 * 60}
        />
      );
    case "min-block":
      return (
        <DurationField
          value={draft.minMinutesPerBlock}
          onChange={(v) => update({ minMinutesPerBlock: v === undefined ? undefined : Math.max(15, v) })}
          hint="Auto blocks prefer at least this long while demand remains; small gaps are skipped until the end. With only min block set, the planner allows up to 2 auto blocks per day (e.g. work → gym → work)."
          sliderMinMinutes={15}
          sliderMaxMinutes={8 * 60}
        />
      );
    case "max-blocks-day": {
      const v = draft.maxAutoBlocksPerDay;
      return (
        <div className="flex flex-col gap-1 text-xs">
          <label className="flex flex-col gap-1">
            <span>Max auto blocks per calendar day (1–8)</span>
            <input
              type="number"
              min={1}
              max={8}
              className="field max-w-[8rem] tabular-nums"
              value={v === undefined ? "" : String(v)}
              placeholder="2 (default with min block)"
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw === "") {
                  update({ maxAutoBlocksPerDay: undefined });
                  return;
                }
                const n = Number(raw);
                if (!Number.isFinite(n)) return;
                update({ maxAutoBlocksPerDay: Math.min(8, Math.max(1, Math.round(n))) });
              }}
            />
          </label>
          <p className="text-[11px] text-ink-400">
            Pins don’t count. Leave empty for the planner default: 2 when min block size is set; for
            goals with sessions/week, default is 1 per day—raise this to 2 if you want morning and
            afternoon auto blocks on the same day (subject to daily cap and demand).
          </p>
        </div>
      );
    }
    case "share-remainder":
      return (
        <PercentShareField
          value={draft.allocationSharePercent}
          onChange={(allocationSharePercent) => update({ allocationSharePercent })}
          defaultPercent={defaultAllocationSharePercent}
          hint={
            <>
              Percent of <strong>full-week schedulable time</strong> (after segments). Pass 2 never
              assigns more than the pool left after weekly mins; 100% targets that whole pool for
              this row. Several % rows should add to ≤100% or the planner scales them down.
            </>
          }
        />
      );
    case "frequency":
      return (
        <SessionsPerWeekField
          value={draft.frequencyPerWeek}
          onChange={(frequencyPerWeek) => update({ frequencyPerWeek })}
        />
      );
    case "days": {
      const pinnedDays = draft.daysOfWeek?.length
        ? draft.daysOfWeek
        : draft.dayOfWeek
          ? [draft.dayOfWeek]
          : [];
      return (
        <WeekdayToggleGrid
          selected={pinnedDays.length > 0 ? pinnedDays : undefined}
          onChange={(next) =>
            update({
              daysOfWeek: next && next.length > 0 ? next : undefined,
              dayOfWeek: undefined
            })
          }
        />
      );
    }
    case "nice-weather":
      return (
        <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-300">
          Only schedule during timemap &quot;outside&quot; windows from your weather settings (same
          layer as the green preview on the calendar). If weather is disabled or no forecast
          overlaps your free time, this is ignored so the goal can still land.
        </p>
      );
    case "ideal-start-times": {
      const clocks = normaliseIdealClockTimes(
        draft.placementIdealClockTimes,
        { hour: 12, minute: 0 }
      );
      return (
        <div className="flex flex-col gap-2">
          <IdealClockTimesField
            value={clocks}
            onChange={(placementIdealClockTimes) => update({ placementIdealClockTimes })}
          />
          <p className="text-[11px] text-ink-400">
            Nudges gap choice and tries to start blocks at these local times when the gap allows
            (weak signal versus hard earliest/latest hour, if you add those elsewhere).
          </p>
        </div>
      );
    }
    case "ideal-after-local": {
      const b = draftIdealAfterBoundary(draft);
      return (
        <IdealPlacementClockAfterField
          value={b}
          onChange={(next) => update(patchIdealAfter(draft, normalisePlacementIdealClockBoundary(next)))}
        />
      );
    }
    case "ideal-before-local": {
      const b = draftIdealBeforeBoundary(draft);
      return (
        <IdealPlacementClockBeforeField
          value={b}
          onChange={(next) => update(patchIdealBefore(draft, normalisePlacementIdealClockBoundary(next)))}
        />
      );
    }
  }
}

/* ─────────────────────────── Empty state ─────────────────────────────────── */

function EmptyState({
  onAdd,
  onAddPhysicalActivity,
  physicalActivityDisabled
}: {
  onAdd: (title: string, draft: GoalDraft) => void;
  onAddPhysicalActivity: () => void;
  physicalActivityDisabled: boolean;
}) {
  return (
    <section className="card flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold">Start with a few ideas</h2>
        <p className="text-xs text-ink-400">
          Tap any to add it; tweak the constraints later by clicking the row.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {STARTER_GOALS.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() =>
              onAdd(s.title, {
                energyMode: s.energy ?? "neutral",
                energyPolarity: "neutral",
                attentionMode: "unspecified",
                workLayer: "unspecified",
                ppfHorizon: "unspecified",
                commitmentLevel: "committed"
              })
            }
            className="btn-secondary text-xs"
          >
            + {s.title}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-ink-200 pt-3 dark:border-ink-600">
        <button
          type="button"
          onClick={onAddPhysicalActivity}
          disabled={physicalActivityDisabled}
          className="btn-secondary text-xs"
        >
          + Physical activity
        </button>
      </div>
    </section>
  );
}
