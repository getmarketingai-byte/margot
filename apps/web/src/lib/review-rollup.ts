/**
 * Pure helpers that turn a set of DailyReviews + planner output into
 * per-goal pace metrics for the Review weekly page and the Plan badges.
 *
 * Intentionally framework-free: every input is a plain shape so this module
 * can be exercised in unit tests and reused server-side without pulling
 * Drizzle / Next into the dependency graph.
 */

import {
  catchUpFloorsFromRecommendations,
  type DailyReview,
  type EnergyState,
  type WeeklyGoal
} from "@calendar-automations/schema";

export type PaceStatus = "ahead" | "on-track" | "behind" | "no-data";

export interface GoalRollup {
  goalId: string;
  /** Sum of `slot.endMinute - slot.startMinute` for slots tagged to the goal. */
  actualMinutesFromSlots: number;
  /** Sum of `goalMark.actualMinutes` overrides across the week, when set. */
  actualMinutesFromMarks: number;
  /**
   * Effective actual minutes used for pace math. Marks win when present;
   * otherwise we fall back to the slot-derived total. This lets the user
   * override the auto-tally without losing it.
   */
  effectiveActualMinutes: number;
  /** Allocator's effective weekly target for the goal. */
  targetMinutes: number;
  /**
   * Pro-rated target up to and including `dayIndex` of the week. Used to
   * decide if the user is on-track mid-week.
   */
  targetToDate: number;
  /** `effectiveActualMinutes - targetToDate`. Positive = ahead, negative = behind. */
  deltaMinutes: number;
  /** Recommended catch-up for the remainder of the week (clamped to >= 0). */
  catchUpRecommendation: number;
  /** Bucket used by chips/banners. */
  status: PaceStatus;
  /** Day-by-day actual minutes (length 7, Mon-first). */
  byDay: number[];
}

export interface GoalRollupInput {
  /** Plan goals (in user/priority order); only these are reported on. */
  goals: readonly WeeklyGoal[];
  /** Daily reviews keyed by ISO date. */
  reviewsByDate: ReadonlyMap<string, DailyReview>;
  /** Allocator metrics: goalId -> targetMinutes for the week. */
  effectiveTargetByGoal: Readonly<Record<string, number>>;
  /**
   * When set (e.g. Perfect Week plan page), pace uses these achieved minutes
   * per goal — same tally as `metrics.perGoal[].scheduledMinutes` (logs + plan,
   * merged) so Behind/Ahead matches the `achieved / target` line. Weekly Review
   * pages omit this and use only day-sheet slots / goal marks.
   */
  allocatorAchievedByGoal?: Readonly<Record<string, number>>;
  /** ISO dates for the week, Monday-first. */
  weekDates: readonly string[];
  /**
   * 0..6 index of "today" within the week. Used to pro-rate targets and
   * skew catch-up recommendations toward remaining days. When the week is
   * fully in the past (e.g. reviewing last week), pass 6.
   */
  dayIndex: number;
}

const SLOT_TO_MIN = (a: { startMinute: number; endMinute: number }) =>
  Math.max(0, a.endMinute - a.startMinute);

/** Threshold (minutes) at which we move from "on-track" to "behind". */
const BEHIND_THRESHOLD_MIN = 30;
/** Threshold (minutes) at which we move from "on-track" to "ahead". */
const AHEAD_THRESHOLD_MIN = 30;

export function computeGoalRollups(input: GoalRollupInput): GoalRollup[] {
  const {
    goals,
    reviewsByDate,
    effectiveTargetByGoal,
    allocatorAchievedByGoal,
    weekDates,
    dayIndex
  } = input;
  const dayCount = weekDates.length;
  const proRateBasis = Math.max(1, Math.min(dayIndex + 1, dayCount));

  return goals.map((goal) => {
    const byDay: number[] = new Array(dayCount).fill(0);
    let actualFromSlots = 0;
    let actualFromMarks = 0;

    for (let i = 0; i < dayCount; i++) {
      const date = weekDates[i]!;
      const review = reviewsByDate.get(date);
      if (!review) continue;
      let dayMinutesSlots = 0;
      for (const slot of review.slots) {
        if (slot.goalId !== goal.id) continue;
        dayMinutesSlots += SLOT_TO_MIN(slot);
      }
      // A goal mark with explicit actualMinutes wins for that day; otherwise
      // the slot tally feeds the rollup unchanged.
      const mark = review.goalMarks.find((m) => m.goalId === goal.id);
      const dayMinutesMark = mark?.actualMinutes;
      const dayMinutes =
        dayMinutesMark !== undefined ? dayMinutesMark : dayMinutesSlots;
      byDay[i] = dayMinutes;
      actualFromSlots += dayMinutesSlots;
      if (dayMinutesMark !== undefined) actualFromMarks += dayMinutesMark;
    }

    const target = effectiveTargetByGoal[goal.id] ?? 0;
    const targetToDate = Math.round((target * proRateBasis) / dayCount);
    const fromReviews = byDay.reduce((acc, m) => acc + m, 0);
    const useAllocatorPace =
      allocatorAchievedByGoal != null && Object.hasOwn(allocatorAchievedByGoal, goal.id);
    const effective = useAllocatorPace ? allocatorAchievedByGoal[goal.id]! : fromReviews;
    const delta = effective - targetToDate;
    const remainingDays = Math.max(0, dayCount - proRateBasis);
    const remainingTarget = Math.max(0, target - effective);

    let status: PaceStatus = "on-track";
    const hasAnyData = useAllocatorPace ? true : byDay.some((m) => m > 0);
    if (!hasAnyData && proRateBasis > 1) {
      status = "no-data";
    } else if (delta <= -BEHIND_THRESHOLD_MIN) {
      status = "behind";
    } else if (delta >= AHEAD_THRESHOLD_MIN) {
      status = "ahead";
    }

    // Catch-up recommendation: how much extra to schedule on the remaining
    // days to hit the original weekly target. We never recommend a negative
    // adjustment from the rollup helper — clearing/shrinking is a manual
    // user choice in the weekly UI.
    const catchUp = remainingDays > 0 ? Math.max(0, remainingTarget - target * (remainingDays / dayCount)) : 0;
    const catchUpRecommendation = Math.round(catchUp);

    return {
      goalId: goal.id,
      actualMinutesFromSlots: actualFromSlots,
      actualMinutesFromMarks: actualFromMarks,
      effectiveActualMinutes: effective,
      targetMinutes: target,
      targetToDate,
      deltaMinutes: delta,
      catchUpRecommendation,
      status,
      byDay
    };
  });
}

/** Floors for `allocateWeek` from rollup recommendations (positive only). */
export function catchUpFloorsFromGoalRollups(
  rollups: readonly GoalRollup[]
): Record<string, number> {
  return catchUpFloorsFromRecommendations(rollups);
}

/**
 * Total minutes per energy bucket across the week, summed from log slots.
 * Drives the Dan Martell-style energise/drain summary on the weekly review.
 */
export function computeEnergyTotals(
  reviews: readonly DailyReview[]
): Record<EnergyState, number> {
  const out: Record<EnergyState, number> = { energise: 0, neutral: 0, drain: 0 };
  for (const r of reviews) {
    for (const s of r.slots) {
      const minutes = SLOT_TO_MIN(s);
      out[s.energy] += minutes;
    }
  }
  return out;
}

/**
 * Top-N goals (or activity notes) ranked by drain minutes. Source material
 * for the "buy back" / "loathe" candidates list on the weekly review.
 */
export function topDrainCandidates(
  reviews: readonly DailyReview[],
  goalLabels: ReadonlyMap<string, string>,
  limit = 3
): Array<{ key: string; label: string; minutes: number }> {
  const tally = new Map<string, { label: string; minutes: number }>();
  for (const r of reviews) {
    for (const s of r.slots) {
      if (s.energy !== "drain") continue;
      const minutes = SLOT_TO_MIN(s);
      const key = s.goalId
        ? `goal:${s.goalId}`
        : s.note
          ? `note:${s.note.slice(0, 40)}`
          : `cat:${s.category}`;
      const label =
        s.goalId && goalLabels.get(s.goalId)
          ? goalLabels.get(s.goalId)!
          : s.note
            ? s.note
            : s.category;
      const existing = tally.get(key);
      if (existing) existing.minutes += minutes;
      else tally.set(key, { label, minutes });
    }
  }
  return [...tally.entries()]
    .map(([key, v]) => ({ key, label: v.label, minutes: v.minutes }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, limit);
}
