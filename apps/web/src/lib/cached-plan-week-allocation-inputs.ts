/**
 * Cross-request caching for expensive `loadPlanWeekAllocationInputs`.
 * Tagged per user — call `invalidateUserAllocationCache(userId)` on any mutation
 * that affects plan, settings, calendars, reviews, or week review/catch-up.
 */

import "server-only";

import { createHash } from "crypto";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { unstable_cache, revalidateTag } from "next/cache";
import type { DailyReview, UserSettings, WeeklyPlan } from "@calendar-automations/schema";

import type { PlanWeekAllocationInputs } from "./allocation-run-context";
import { loadPlanWeekAllocationInputs } from "./allocation-run-context";
import { isLoggedActualSleepTitle } from "./week-blocks";

const ALLOC_CACHE_HOUR_MS = 60 * 60 * 1000;

function repoRootFromCwd(): string {
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function appendDebugSessionLog(payload: Record<string, unknown>): void {
  try {
    const root = repoRootFromCwd();
    const cursorDir = join(root, ".cursor");
    mkdirSync(cursorDir, { recursive: true });
    appendFileSync(join(cursorDir, "debug-dba26f.log"), `${JSON.stringify(payload)}\n`);
  } catch {
    /* ignore */
  }
}

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
  const hourBucket = Math.floor(nowMs / ALLOC_CACHE_HOUR_MS);

  const cached = await unstable_cache(
    async (): Promise<CachedPlanWeekAllocationInputs> => {
      const inputs = await loadPlanWeekAllocationInputs({ userId, plan, settings, nowMs });
      return {
        ...inputs,
        reviewsByDateEntries: [...inputs.reviewsByDate.entries()]
      };
    },
    // `nowMs` affects Google fetch windows, catch-up day index, from-now metrics,
    // and any time-dependent system placement. Key must move forward in time or
    // the first request freezes the whole week (stale busy + inflated capacity).
    // Hour bucket limits cache churn while keeping dashboard data fresh.
    ["plan-week-alloc-inputs-v3", userId, fp, String(hourBucket)],
    { tags: [userAllocationCacheTag(userId)] }
  )();

  const result: PlanWeekAllocationInputs = {
    ...cached,
    reviewsByDate: new Map(cached.reviewsByDateEntries)
  };

  // #region agent log
  {
    const sleepBlockCount = result.systemBlocks.filter((b) => b.system === "sleep").length;
    const loggedActualSleepBusyCount = result.busy.filter(
      (e) => e.busy && isLoggedActualSleepTitle(e.title)
    ).length;
    appendDebugSessionLog({
      sessionId: "dba26f",
      hypothesisId: "H-alloc-cache-hour-bucket",
      location: "cached-plan-week-allocation-inputs.ts:getCachedPlanWeekAllocationInputs",
      message: "plan week allocation inputs",
      data: {
        hourBucket,
        sleepBlockCount,
        loggedActualSleepBusyCount,
        nowMs: result.nowMs
      },
      timestamp: Date.now()
    });
  }
  // #endregion

  return result;
}
