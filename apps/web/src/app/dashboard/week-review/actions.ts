"use server";

import { revalidatePath } from "next/cache";
import {
  type BurchardWeeklyQuestions,
  type WeeklyReview
} from "@calendar-automations/schema";
import { authOrPreview } from "@/lib/auth";
import { invalidateUserAllocationCache } from "@/lib/cached-plan-week-allocation-inputs";
import { revalidatePlanningRoutes } from "@/lib/dashboard-revalidate";
import { loadWeeklyReview, saveWeeklyReview } from "@/lib/review-store";
import { loadSettings } from "@/lib/settings-store";
import { localMondayIso } from "@/lib/week";

async function loadForUser(weekStart?: string): Promise<{
  userId: string;
  review: WeeklyReview;
}> {
  const session = await authOrPreview();
  if (!session?.user?.id) throw new Error("unauthorised");
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const ws = weekStart ?? localMondayIso(settings.timezone);
  const review = await loadWeeklyReview(userId, ws, settings.timezone);
  return { userId, review };
}

function commit(userId: string, review: WeeklyReview): Promise<void> {
  return saveWeeklyReview(userId, review).then(() => {
    invalidateUserAllocationCache(userId);
    revalidatePath("/dashboard/week-review");
    revalidatePath("/dashboard/review");
    revalidatePlanningRoutes();
  });
}

export async function upsertBurchardWeekly(
  weekStart: string,
  burchardQuestions: BurchardWeeklyQuestions
): Promise<void> {
  const { userId, review } = await loadForUser(weekStart);
  await commit(userId, { ...review, burchardQuestions });
}

/**
 * Replace the entire `catchUpAdjustments` map. Pass `{}` to clear all
 * adjustments. Negative values are honoured (lets you shrink a goal that
 * ran ahead).
 */
export async function applyCatchUp(
  weekStart: string,
  adjustments: Record<string, number>
): Promise<void> {
  const { userId, review } = await loadForUser(weekStart);
  // Drop zero entries so the row stays compact.
  const cleaned: Record<string, number> = {};
  for (const [goalId, minutes] of Object.entries(adjustments)) {
    const rounded = Math.round(minutes);
    if (rounded === 0) continue;
    cleaned[goalId] = rounded;
  }
  await commit(userId, {
    ...review,
    catchUpAdjustments: cleaned,
    appliedAt: Object.keys(cleaned).length > 0 ? Date.now() : undefined
  });
}

export async function clearCatchUp(weekStart: string): Promise<void> {
  await applyCatchUp(weekStart, {});
}
