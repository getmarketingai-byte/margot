/**
 * Synthetic busy intervals from day-sheet goal log slots. Feeds the planner
 * and week grid so logged time consumes free gaps like calendar events.
 */

import type { DailyReview } from "@calendar-automations/schema";
import type { BusyEvent } from "@calendar-automations/planner";
import { clip, mergeIntervals, type Interval } from "@calendar-automations/planner";
import { localMidnightMs } from "@/lib/week";

export interface DaySheetGoalBusyInput {
  reviewsByDate: ReadonlyMap<string, DailyReview>;
  weekDates: readonly string[];
  timezone: string;
  weekStartMs: number;
  weekEndMs: number;
  /** Only slots whose goalId appears here are included (e.g. scheduling goals). */
  goalTitleById: ReadonlyMap<string, string>;
}

/**
 * Build merged, week-clipped `BusyEvent`s from `category: "goal"` slots with
 * a `goalId`. Per-goal overlapping/touching intervals are merged before export.
 */
export function daySheetGoalBusyEvents(input: DaySheetGoalBusyInput): BusyEvent[] {
  const { reviewsByDate, weekDates, timezone, weekStartMs, weekEndMs, goalTitleById } = input;
  const byGoal = new Map<string, Interval[]>();

  for (const date of weekDates) {
    const review = reviewsByDate.get(date);
    if (!review) continue;

    const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
    const dayStartMs = localMidnightMs(y, mo, d, timezone);

    for (const slot of review.slots) {
      if (slot.category !== "goal" || !slot.goalId) continue;
      if (!goalTitleById.has(slot.goalId)) continue;
      const startMs = dayStartMs + slot.startMinute * 60_000;
      const endMs = dayStartMs + slot.endMinute * 60_000;
      if (endMs <= startMs) continue;

      const clipped = clip({ startMs, endMs }, weekStartMs, weekEndMs);
      if (!clipped) continue;

      const list = byGoal.get(slot.goalId);
      if (list) list.push(clipped);
      else byGoal.set(slot.goalId, [clipped]);
    }
  }

  const out: BusyEvent[] = [];
  for (const [goalId, intervals] of byGoal) {
    const merged = mergeIntervals(intervals);
    const title = goalTitleById.get(goalId) ?? "Goal";
    for (const inv of merged) {
      if (inv.endMs <= inv.startMs) continue;
      out.push({
        sourceId: `daysheet-goal:${goalId}:${inv.startMs}:${inv.endMs}`,
        /* Screen readers / ICS: distinguish from raw "proposed" copy */
        title: `${title} (logged)`,
        startMs: inv.startMs,
        endMs: inv.endMs,
        busy: true,
        source: "internal"
      });
    }
  }

  return out.sort((a, b) => a.startMs - b.startMs);
}
