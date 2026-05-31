/**
 * Rebuilds each day’s `plannedBlocksSnapshot` from the current allocator so
 * the day sheet “Planned …” headers match Perfect Week after overrides
 * (e.g. day-sheet actuals).
 */

import "server-only";

import type {
  AllocatedBlockSnapshot,
  UserSettings,
  WeeklyPlan
} from "@margot/schema";
import { runThisWeekAllocationForPlan } from "@/lib/perfect-week-this-week-allocation";
import { loadDailyReview, saveDailyReview } from "@/lib/review-store";
import { localMidnightMs } from "@/lib/week";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function refreshPlannedSnapshotsForCurrentWeek(
  userId: string,
  plan: WeeklyPlan,
  settings: UserSettings
): Promise<void> {
  const run = await runThisWeekAllocationForPlan(userId, plan, settings);
  if (!run) return;
  const { allocation, weekDates } = run;
  const tz = settings.timezone;

  for (const date of weekDates) {
    const parts = date.split("-").map(Number) as [number, number, number];
    const [y, mo, d] = parts;
    const dayStartMs = localMidnightMs(y, mo, d, tz);
    const dayEndMs = dayStartMs + DAY_MS;
    const snapshots: AllocatedBlockSnapshot[] = allocation.blocks
      .filter(
        (b) =>
          !b.segment &&
          b.startMs < b.endMs &&
          b.startMs >= dayStartMs &&
          b.endMs <= dayEndMs
      )
      .map((b) => ({
        goalId: b.goalId,
        title: b.title,
        startMs: b.startMs,
        endMs: b.endMs,
        ...(b.dragKey ? { dragKey: b.dragKey } : {})
      }));
    const review = await loadDailyReview(userId, date, tz);
    review.plannedBlocksSnapshot = snapshots;
    await saveDailyReview(userId, review);
  }
}
