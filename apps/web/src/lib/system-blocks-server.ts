/**
 * Server-only orchestration around `computeSystemBlocks`.
 *
 * Wraps the three render-time concerns (build a resolver, compute blocks,
 * persist freshly-fetched durations to the cache) so dashboard pages can
 * call a single function. Keeps the routing/cache plumbing out of page
 * components.
 *
 * Reading and writing both happen against `loadSettings(userId)`. Because a
 * server render is one short-lived request the in-flight settings copy is
 * authoritative for the whole render, so saving back with the new
 * `travelCache` slice doesn't risk clobbering other slices.
 */

import "server-only";

import type { WeeklyPlan, UserSettings } from "@calendar-automations/schema";
import type { BusyEvent } from "@calendar-automations/planner";
import { saveSettings } from "./settings-store";
import {
  computeSystemBlocks,
  type SystemBlock,
  type SystemBlocksOverrides
} from "./week-blocks";
import { createLegResolver } from "./routing";

export interface BuildSystemBlocksArgs {
  userId: string;
  settings: UserSettings;
  weekStartMs: number;
  busy: readonly BusyEvent[];
  /** Optional overrides pulled from the active WeeklyPlan. */
  overrides?: SystemBlocksOverrides;
  nowMs?: number;
}

export async function buildSystemBlocks(
  args: BuildSystemBlocksArgs
): Promise<SystemBlock[]> {
  const { userId, settings, weekStartMs, busy, overrides, nowMs } = args;
  const resolver = createLegResolver({
    travel: settings.travel,
    cache: settings.travelCache
  });

  const blocks = await computeSystemBlocks(
    weekStartMs,
    busy,
    settings.sleep,
    settings.travel,
    settings.gym,
    settings.timezone,
    resolver,
    settings.timemap,
    overrides,
    nowMs
  );

  // Persist any newly-resolved leg durations / geocodes. Skip the write if
  // the resolver didn't touch anything (the common path).
  const updates = resolver.takeCacheUpdates();
  if (updates) {
    try {
      await saveSettings(userId, { ...settings, travelCache: updates });
    } catch (err) {
      // Cache writes are best-effort — never block a render if they fail.
      console.warn("buildSystemBlocks: cache flush failed", err);
    }
  }

  return blocks;
}

/** Helper to extract overrides from a stored WeeklyPlan. */
export function overridesFromPlan(plan: WeeklyPlan | undefined): SystemBlocksOverrides {
  const sleep = new Map<number, { key: number; startMs: number; endMs: number }>();
  const routine = new Map<string, { key: string; startMs: number; endMs: number }>();
  if (!plan?.overrides) return { sleep, routine };
  for (const o of plan.overrides) {
    if (o.kind === "sleep") {
      const idx = Number(o.key);
      if (Number.isFinite(idx)) {
        sleep.set(idx, { key: idx, startMs: o.startMs, endMs: o.endMs });
      }
    } else if (o.kind === "routine") {
      routine.set(o.key, { key: o.key, startMs: o.startMs, endMs: o.endMs });
    }
  }
  return { sleep, routine };
}
