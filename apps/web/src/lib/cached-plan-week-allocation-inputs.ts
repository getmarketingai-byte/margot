/**
 * Cross-request caching for expensive `loadPlanWeekAllocationInputs`.
 * Tagged per user — call `invalidateUserAllocationCache(userId)` on any mutation
 * that affects plan, settings, calendars, reviews, or week review/catch-up.
 */

import "server-only";

import { createHash } from "crypto";
import { unstable_cache, revalidateTag } from "next/cache";
import type { DailyReview, UserSettings, WeeklyPlan } from "@calendar-automations/schema";

import type { PlanWeekAllocationInputs } from "./allocation-run-context";
import { loadPlanWeekAllocationInputs } from "./allocation-run-context";

type CachedPlanWeekAllocationInputs = Omit<PlanWeekAllocationInputs, "reviewsByDate"> & {
  reviewsByDateEntries: Array<[string, DailyReview]>;
};

export function userAllocationCacheTag(userId: string): string {
  return `user-alloc-context-${userId}`;
}

function fingerprint(plan: WeeklyPlan, settings: UserSettings): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        plan,
        settings
      })
    )
    .digest("hex")
    .slice(0, 32);
}

export function invalidateUserAllocationCache(userId: string): void {
  revalidateTag(userAllocationCacheTag(userId));
}

export async function getCachedPlanWeekAllocationInputs(options: {
  userId: string;
  plan: WeeklyPlan;
  settings: UserSettings;
  nowMs: number;
}): Promise<PlanWeekAllocationInputs> {
  const { userId, plan, settings, nowMs } = options;
  const fp = fingerprint(plan, settings);

  const cached = await unstable_cache(
    async (): Promise<CachedPlanWeekAllocationInputs> => {
      const inputs = await loadPlanWeekAllocationInputs({ userId, plan, settings, nowMs });
      return {
        ...inputs,
        reviewsByDateEntries: [...inputs.reviewsByDate.entries()]
      };
    },
    // Keep this cache stable across page revisits. It should only bust when
    // plan/settings fingerprints change or explicit mutation paths call
    // `invalidateUserAllocationCache(userId)`.
    ["plan-week-alloc-inputs-v2", userId, fp],
    { tags: [userAllocationCacheTag(userId)] }
  )();

  return {
    ...cached,
    reviewsByDate: new Map(cached.reviewsByDateEntries)
  };
}
