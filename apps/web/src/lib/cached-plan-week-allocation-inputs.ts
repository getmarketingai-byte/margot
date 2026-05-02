/**
 * Cross-request caching for expensive `loadPlanWeekAllocationInputs`.
 * Tagged per user — call `invalidateUserAllocationCache(userId)` on any mutation
 * that affects plan, settings, calendars, reviews, or week review/catch-up.
 */

import "server-only";

import { createHash } from "crypto";
import { unstable_cache } from "next/cache";
import type { DailyReview, UserSettings, WeeklyPlan } from "@calendar-automations/schema";

import type { BillingState } from "@/lib/subscription";
import type { PlanWeekAllocationInputs } from "./allocation-run-context";
import { loadPlanWeekAllocationInputs } from "./allocation-run-context";
import { userAllocationCacheTag } from "./allocation-cache-invalidation";
import { effectiveScheduleHorizon } from "./effective-schedule-horizon";
import { localMondayMidnightMs } from "./week";

const ALLOC_CACHE_HOUR_MS = 60 * 60 * 1000;

type CachedPlanWeekAllocationInputs = Omit<PlanWeekAllocationInputs, "reviewsByDate"> & {
  reviewsByDateEntries: Array<[string, DailyReview]>;
};

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

export async function getCachedPlanWeekAllocationInputs(options: {
  userId: string;
  plan: WeeklyPlan;
  settings: UserSettings;
  nowMs: number;
  billing: BillingState;
}): Promise<PlanWeekAllocationInputs> {
  const { userId, plan, settings, nowMs, billing } = options;
  const fp = fingerprint(plan, settings);
  const hourBucket = Math.floor(nowMs / ALLOC_CACHE_HOUR_MS);
  const baseMonday = localMondayMidnightMs(settings.timezone, new Date(nowMs));
  const hzSeg = effectiveScheduleHorizon({
    billing,
    storedScheduleHorizonWeeks: settings.calendars.scheduleHorizonWeeks,
    nowMs,
    baseWeekStartMs: baseMonday
  }).cacheKeySegment;

  const cached = await unstable_cache(
    async (): Promise<CachedPlanWeekAllocationInputs> => {
      const inputs = await loadPlanWeekAllocationInputs({ userId, plan, settings, nowMs, billing });
      return {
        ...inputs,
        reviewsByDateEntries: [...inputs.reviewsByDate.entries()]
      };
    },
    // `nowMs` affects Google fetch windows, catch-up day index, from-now metrics,
    // and any time-dependent system placement. Key must move forward in time or
    // the first request freezes the whole week (stale busy + inflated capacity).
    // Hour bucket limits cache churn while keeping dashboard data fresh.
    ["plan-week-alloc-inputs-v4", userId, fp, String(hourBucket), hzSeg],
    { tags: [userAllocationCacheTag(userId)] }
  )();

  return {
    ...cached,
    reviewsByDate: new Map(cached.reviewsByDateEntries)
  };
}

export {
  invalidateUserAllocationCache,
  userAllocationCacheTag
} from "./allocation-cache-invalidation";
