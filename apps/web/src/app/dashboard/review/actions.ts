"use server";

import { revalidatePath } from "next/cache";
import {
  type AllocatedBlockSnapshot,
  type DailyReview,
  type EveningScorecard,
  type LogSlot,
  type MorningPrompt,
  blockMarkSchema,
  goalMarkSchema,
  logSlotSchema
} from "@calendar-automations/schema";
import { authOrPreview } from "@/lib/auth";
import { loadDailyReview, saveDailyReview } from "@/lib/review-store";
import { syncActualGoalOverridesFromDayLogs } from "@/app/dashboard/plan/actions";
import { loadSettings } from "@/lib/settings-store";

async function loadReviewForUser(date: string): Promise<{
  userId: string;
  review: DailyReview;
}> {
  const session = await authOrPreview();
  if (!session?.user?.id) throw new Error("unauthorised");
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const review = await loadDailyReview(userId, date, settings.timezone);
  return { userId, review };
}

function commit(
  userId: string,
  review: DailyReview
): Promise<void> {
  return saveDailyReview(userId, review).then(() => {
    revalidatePath("/dashboard/review");
    revalidatePath("/dashboard/week-review");
    revalidatePath("/dashboard/plan");
  });
}

/**
 * Initialise a fresh daily review row with the current allocator's blocks
 * snapshot. No-op when a row already exists. Useful so block marks always
 * have a stable list of blocks to attach to.
 */
export async function ensureDailyReview(
  date: string,
  plannedBlocksSnapshot: AllocatedBlockSnapshot[]
): Promise<void> {
  const { userId, review } = await loadReviewForUser(date);
  if (review.plannedBlocksSnapshot.length > 0) return;
  await commit(userId, { ...review, plannedBlocksSnapshot });
}

export async function upsertMorning(
  date: string,
  morning: MorningPrompt
): Promise<void> {
  const { userId, review } = await loadReviewForUser(date);
  await commit(userId, { ...review, morning });
}

export async function setLogSlots(
  date: string,
  slots: LogSlot[]
): Promise<void> {
  const { userId, review } = await loadReviewForUser(date);
  // Re-validate each slot defensively; the schema rejects malformed times.
  const parsed = slots.map((s) => logSlotSchema.parse(s));
  await commit(userId, { ...review, slots: parsed });
  await syncActualGoalOverridesFromDayLogs();
}

export async function setBlockMark(
  date: string,
  blockKey: string,
  status: "done" | "partial" | "skipped" | null,
  actualMinutes?: number,
  note?: string
): Promise<void> {
  const { userId, review } = await loadReviewForUser(date);
  const filtered = review.blockMarks.filter((m) => m.blockKey !== blockKey);
  const next: DailyReview = { ...review, blockMarks: filtered };
  if (status !== null) {
    next.blockMarks.push(
      blockMarkSchema.parse({ blockKey, status, actualMinutes, note })
    );
  }
  await commit(userId, next);
}

export async function setGoalMark(
  date: string,
  goalId: string,
  status: "done" | "partial" | "skipped" | "in-progress" | null,
  actualMinutes?: number,
  note?: string
): Promise<void> {
  const { userId, review } = await loadReviewForUser(date);
  const filtered = review.goalMarks.filter((m) => m.goalId !== goalId);
  const next: DailyReview = { ...review, goalMarks: filtered };
  if (status !== null) {
    next.goalMarks.push(
      goalMarkSchema.parse({ goalId, status, actualMinutes, note })
    );
  }
  await commit(userId, next);
}

export async function upsertEvening(
  date: string,
  evening: EveningScorecard
): Promise<void> {
  const { userId, review } = await loadReviewForUser(date);
  await commit(userId, { ...review, evening });
}
