/**
 * Runs `allocateWeek` for the current dashboard week using the same inputs as
 * My Perfect Week (busy, system blocks, weather windows, catch-up mode). Used
 * when deriving planner `dragKey`s for syncing day-sheet logs into overrides.
 */

import { eq } from "drizzle-orm";
import {
  type DailyReview,
  type UserSettings,
  type WeeklyPlan,
  weeklyIntentSchema,
  weeklyPlanSchema
} from "@calendar-automations/schema";
import { allocateWeek, goalOverrideSourcesFromPlan, type AllocateResult } from "@calendar-automations/planner";
import { db, schema } from "@/lib/db";
import { localMondayIso } from "@/lib/week";
import { getCachedPlanWeekAllocationInputs } from "@/lib/cached-plan-week-allocation-inputs";
import { loadBillingState } from "@/lib/billing-state-server";
import { sleepIntervalsForAllocation } from "@/lib/week-blocks";
import { processExpiredWeeklyPlanTrash } from "@/lib/weekly-plan-trash";

async function loadDashboardWeeklyPlan(userId: string, timezone: string): Promise<WeeklyPlan> {
  const weekStart = localMondayIso(timezone);
  const blank = weeklyIntentSchema.parse({});
  if (!db) {
    return processExpiredWeeklyPlanTrash(
      userId,
      weeklyPlanSchema.parse({
        id: "dev",
        weekStart,
        timezone,
        goals: [],
        deletedGoals: [],
        goalGroups: [],
        overrides: [],
        weeklyIntent: blank
      })
    );
  }
  const rows = await db
    .select()
    .from(schema.weeklyPlans)
    .where(eq(schema.weeklyPlans.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return processExpiredWeeklyPlanTrash(
      userId,
      weeklyPlanSchema.parse({
        id: crypto.randomUUID(),
        weekStart,
        timezone,
        goals: [],
        deletedGoals: [],
        goalGroups: [],
        overrides: [],
        weeklyIntent: blank
      })
    );
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

/**
 * Allocates the current week using `plan` as-is (caller strips `source:
 * "actual"` overrides when baseline drag keys are needed).
 */
export async function runThisWeekAllocationForPlan(
  userId: string,
  plan: WeeklyPlan,
  settings: UserSettings
): Promise<{
  allocation: AllocateResult;
  weekDates: string[];
  reviewsByDate: Map<string, DailyReview>;
} | null> {
  if (!db) return null;

  const billing = await loadBillingState(userId);
  const ctx = await getCachedPlanWeekAllocationInputs({
    userId,
    plan,
    settings,
    nowMs: Date.now(),
    billing
  });

  const allocation = allocateWeek({
    plan,
    busy: [...ctx.busy, ...ctx.daySheetGoalBusyThisWeek, ...ctx.systemBlocks],
    goalAvailabilityWindows: ctx.busyFetch.goalAvailabilityWindows,
    niceWeatherWindows: ctx.niceWeatherThisWeek,
    settings,
    weekStartMs: ctx.weekStartMs,
    weekEndMs: ctx.weekEndMs,
    catchUpFloors: ctx.catchUpFloors,
    weekAnchorDate: plan.weekStart,
    goalOverrideSources: goalOverrideSourcesFromPlan(plan),
    nowMs: ctx.nowMs,
    sleepIntervals: sleepIntervalsForAllocation(ctx.systemBlocks, ctx.busy)
  });

  return {
    allocation,
    weekDates: ctx.weekDates,
    reviewsByDate: ctx.reviewsByDate
  };
}

export { loadDashboardWeeklyPlan };
