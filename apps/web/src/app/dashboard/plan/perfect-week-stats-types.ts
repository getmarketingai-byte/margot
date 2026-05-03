import type { PaceStatus } from "@/lib/review-rollup";
import type { WeekMetrics } from "@calendar-automations/planner";

/** Server-serialisable stats bundle for one ISO week allocation slice */
export interface PerfectWeekSliceStats {
  weekStartMs: number;
  weekEndMs: number;
  weekDates: readonly string[];
  weekLabel: string;
  freeMinutesThisWeek: number;
  capacityBreakdown: {
    grossWeekMinutes: number;
    busyWeekMinutes: number;
    consistencyReservedWeekMinutes: number;
    busyTrueEventCount: number;
  };
  weekCapacityFromNowMinutes: number;
  remainingWeekMinutes: number;
  remainingFromNowMinutes: number;
  planMinutesByGoal: Record<
    string,
    { loggedMinutes: number; proposedFutureMinutes: number }
  >;
  effectiveTargetByGoal: Record<string, number>;
  paceByGoal: Record<string, GoalPaceInfoSlice>;
  goalGroupGaps: ReadonlyArray<WeekMetrics["goalGroupGaps"][number]>;
  goalGroupMinutes: Record<string, number>;
  overcommitted?: {
    neededMin: number;
    availableMin: number;
    mode: "proportional" | "strict";
  };
  notScheduled: Array<{ goalId: string; title: string; reason: "starved" }>;
}

export interface GoalGroupRailBundle {
  gaps: ReadonlyArray<WeekMetrics["goalGroupGaps"][number]>;
  minutes: Record<string, number>;
  weekLabel?: string;
}

export interface GoalPaceInfoSlice {
  status: PaceStatus;
  deltaMinutes: number;
  actualMinutes: number;
  targetToDateMinutes?: number;
}

/** Window clip approximation for rolling “next 7 days” combined stats */
export interface RollingSevenDayApprox {
  windowStartMs: number;
  windowEndMs: number;
  grossWindowMinutes: number;
  occupiedBeforeGoalsApproxMinutes: number;
  occupiedWithGoalsApproxMinutes: number;
  /** gross − occupied before planner goal blocks */
  freeBeforeGoalsApproxMinutes: number;
  /** gross − occupied including proposed blocks */
  freeAfterGoalsApproxMinutes: number;
  proposedMinutesByGoalId: Record<string, number>;
  /** Day-sheet goal logs clipped to the same seven-day strip as proposed minutes */
  loggedMinutesByGoalIdInWindow: Record<string, number>;
  /** Allocator weekly targets from current ISO slice */
  effectiveTargetBaselineByGoalId: Record<string, number>;
}
