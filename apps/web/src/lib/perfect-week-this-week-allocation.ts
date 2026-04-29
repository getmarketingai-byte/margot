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
  weeklyIntentSchema
} from "@calendar-automations/schema";
import { allocateWeek, goalOverrideSourcesFromPlan, type AllocateResult } from "@calendar-automations/planner";
import { db, schema } from "@/lib/db";
import { localMondayIso } from "@/lib/week";
import { loadPlanWeekAllocationInputs } from "@/lib/allocation-run-context";

async function loadDashboardWeeklyPlan(userId: string, timezone: string): Promise<WeeklyPlan> {
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

  const ctx = await loadPlanWeekAllocationInputs({
    userId,
    plan,
    settings,
    nowMs: Date.now()
  });

  const allocation = allocateWeek({
    plan,
    busy: [...ctx.busy, ...ctx.systemBlocks],
    goalAvailabilityWindows: ctx.busyFetch.goalAvailabilityWindows,
    niceWeatherWindows: ctx.niceWeatherThisWeek,
    settings,
    weekStartMs: ctx.weekStartMs,
    weekEndMs: ctx.weekEndMs,
    catchUpFloors: ctx.catchUpFloors,
    weekAnchorDate: plan.weekStart,
    goalOverrideSources: goalOverrideSourcesFromPlan(plan)
  });

  return {
    allocation,
    weekDates: ctx.weekDates,
    reviewsByDate: ctx.reviewsByDate
  };
}

export { loadDashboardWeeklyPlan };
