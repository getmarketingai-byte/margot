import "server-only";

import { dailyReviewSchema, weeklyReviewSchema, type DailyReview } from "@margot/schema";
import {
  loadAllDailyReviewsForUser,
  loadAllWeeklyReviewsForUser,
  saveDailyReview,
  saveWeeklyReview
} from "@/lib/review-store";

/**
 * Collect every `goalId` referenced on a day-sheet slot (any category).
 * Used to warn when trashing a goal that has historical logs.
 */
export function goalIdsReferencedInDaySheetSlotsFromReviews(
  reviews: readonly { slots: readonly { goalId?: string }[] }[]
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const r of reviews) {
    for (const s of r.slots) {
      const id = s.goalId?.trim();
      if (id) ids.add(id);
    }
  }
  return ids;
}

function stripGoalFromDailyReview(review: DailyReview, goalId: string): DailyReview | null {
  let changed = false;
  const slots = review.slots.filter((s) => {
    if (s.goalId === goalId) {
      changed = true;
      return false;
    }
    return true;
  });
  const plannedBlocksSnapshot = review.plannedBlocksSnapshot.filter((b) => {
    if (b.goalId === goalId) {
      changed = true;
      return false;
    }
    return true;
  });
  const goalMarks = review.goalMarks.filter((g) => {
    if (g.goalId === goalId) {
      changed = true;
      return false;
    }
    return true;
  });
  if (!changed) return null;
  return dailyReviewSchema.parse({
    ...review,
    slots,
    plannedBlocksSnapshot,
    goalMarks
  });
}

/**
 * Permanently remove a goal's traces from all daily + weekly reviews (after trash TTL).
 */
export async function purgeGoalIdFromUserReviews(userId: string, goalId: string): Promise<void> {
  const dailies = await loadAllDailyReviewsForUser(userId);
  for (const r of dailies) {
    const next = stripGoalFromDailyReview(r, goalId);
    if (next) await saveDailyReview(userId, next);
  }

  const weeklies = await loadAllWeeklyReviewsForUser(userId);
  for (const w of weeklies) {
    if (!Object.hasOwn(w.catchUpAdjustments, goalId)) continue;
    const catchUpAdjustments = { ...w.catchUpAdjustments };
    delete catchUpAdjustments[goalId];
    const next = weeklyReviewSchema.parse({ ...w, catchUpAdjustments });
    await saveWeeklyReview(userId, next);
  }
}
