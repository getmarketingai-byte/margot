/**
 * Cross-request caching for expensive `loadPlanWeekAllocationInputs`.
 * Tagged per user — call `invalidateUserAllocationCache(userId)` on any mutation
 * that affects plan, settings, calendars, reviews, or week review/catch-up.
 */

import "server-only";

import { createHash } from "crypto";
import { unstable_cache, revalidateTag } from "next/cache";
import type { UserSettings, WeeklyPlan } from "@calendar-automations/schema";

import type { PlanWeekAllocationInputs } from "./allocation-run-context";
import { loadPlanWeekAllocationInputs } from "./allocation-run-context";

const TIME_BUCKET_MS = 120_000;

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
  const bucket = Math.floor(nowMs / TIME_BUCKET_MS);

  return unstable_cache(
    async () => loadPlanWeekAllocationInputs({ userId, plan, settings, nowMs }),
    ["plan-week-alloc-inputs-v1", userId, fp, String(bucket)],
    { tags: [userAllocationCacheTag(userId)] }
  )();
}
