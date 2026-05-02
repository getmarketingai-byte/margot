import "server-only";

import { eq } from "drizzle-orm";
import { weeklyPlanSchema, type WeeklyPlan } from "@calendar-automations/schema";
import { invalidateUserAllocationCache } from "@/lib/cached-plan-week-allocation-inputs";
import { revalidatePlanningRoutes } from "@/lib/dashboard-revalidate";
import { db, schema } from "@/lib/db";
import { parseGoalOverrideKey } from "@/lib/goal-override-key";
import { purgeGoalIdFromUserReviews } from "@/lib/purge-goal-from-reviews";
import { requestUserRegenerate } from "@/lib/request-user-regenerate";

export const GOAL_TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Removes trashed goals past retention, strips their day/weekly review traces,
 * drops matching planner overrides, persists `weekly_plan`, revalidates, regenerates.
 */
export async function processExpiredWeeklyPlanTrash(userId: string, plan: WeeklyPlan): Promise<WeeklyPlan> {
  const parsed = weeklyPlanSchema.parse(plan);
  const now = Date.now();
  const cutoff = now - GOAL_TRASH_RETENTION_MS;
  const purgedIds: string[] = [];
  const deletedGoals = parsed.deletedGoals ?? [];
  const kept = deletedGoals.filter((e) => {
    if (e.deletedAtMs < cutoff) {
      purgedIds.push(e.goal.id);
      return false;
    }
    return true;
  });
  if (purgedIds.length === 0) return parsed;
  const purgedSet = new Set(purgedIds);
  const overrides = parsed.overrides.filter((o) => {
    if (o.kind !== "goal") return true;
    const parsedKey = parseGoalOverrideKey(o.key);
    if (!parsedKey) return true;
    return !purgedSet.has(parsedKey.goalId);
  });
  const next = weeklyPlanSchema.parse({ ...parsed, deletedGoals: kept, overrides });
  for (const gid of purgedIds) {
    await purgeGoalIdFromUserReviews(userId, gid);
  }
  if (db) {
    await db
      .update(schema.weeklyPlans)
      .set({
        data: next,
        weekStart: next.weekStart,
        timezone: next.timezone,
        updatedAt: new Date()
      })
      .where(eq(schema.weeklyPlans.id, next.id));
  }
  invalidateUserAllocationCache(userId);
  revalidatePlanningRoutes({ includeReviews: true });
  await requestUserRegenerate(userId);
  return next;
}
