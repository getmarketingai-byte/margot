/**
 * Appends "orphan" proposed blocks from `WeeklyPlan.overrides` (kind `goal`)
 * that the allocator did not emit under the same `dragKey`.
 *
 * Day-sheet `actual` pins (and any drag that temporarily mismatched keys after
 * re-allocation) still need to show on the Perfect Week calendar.
 */

import type { AllocatedBlock } from "@calendar-automations/planner";
import type { WeeklyPlan } from "@calendar-automations/schema";
import { parseGoalOverrideKey } from "@/lib/goal-override-key";

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Treat allocator output as already showing this pin when times match within a few minutes. */
const OVERRIDE_TIME_SLOP_MS = 2 * 60_000;

function blockAlreadyShowsOverride(
  blocks: readonly AllocatedBlock[],
  goalId: string,
  startMs: number,
  endMs: number
): boolean {
  for (const b of blocks) {
    if (b.segment || b.goalId !== goalId) continue;
    if (
      Math.abs(b.startMs - startMs) <= OVERRIDE_TIME_SLOP_MS &&
      Math.abs(b.endMs - endMs) <= OVERRIDE_TIME_SLOP_MS
    ) {
      return true;
    }
  }
  return false;
}

export function mergeOrphanGoalOverrideBlocks(
  blocks: readonly AllocatedBlock[],
  plan: Pick<WeeklyPlan, "goals" | "overrides">,
  windows: readonly { weekStartMs: number; weekEndMs: number }[],
  options?: {
    /** When false, skip merging this goal’s orphan overrides (hybrid stacked-role). */
    shouldMergeOrphanGoal?: (goalId: string) => boolean;
  }
): AllocatedBlock[] {
  const shouldMergeOrphanGoal = options?.shouldMergeOrphanGoal ?? (() => true);
  const keysPresent = new Set<string>();
  for (const b of blocks) {
    if (!b.segment && b.dragKey) keysPresent.add(b.dragKey);
  }

  const goalById = new Map(plan.goals.map((g) => [g.id, g] as const));
  const extras: AllocatedBlock[] = [];

  for (const o of plan.overrides ?? []) {
    if (o.kind !== "goal") continue;
    if (keysPresent.has(o.key)) continue;
    if (!(o.endMs > o.startMs)) continue;

    let touches = false;
    for (const w of windows) {
      if (intervalsOverlap(o.startMs, o.endMs, w.weekStartMs, w.weekEndMs)) {
        touches = true;
        break;
      }
    }
    if (!touches) continue;

    const parsed = parseGoalOverrideKey(o.key);
    if (!parsed) continue;
    const goal = goalById.get(parsed.goalId);
    if (!goal) continue;
    if (!shouldMergeOrphanGoal(goal.id)) continue;
    if (blockAlreadyShowsOverride(blocks, goal.id, o.startMs, o.endMs)) continue;

    extras.push({
      goalId: goal.id,
      title: goal.title,
      startMs: o.startMs,
      endMs: o.endMs,
      energyMode: goal.energyMode ?? "neutral",
      ...(goal.wheelAreaId !== undefined ? { wheelAreaId: goal.wheelAreaId } : {}),
      ...(goal.ppfPillar !== undefined ? { ppfPillar: goal.ppfPillar } : {}),
      ...(goal.hp6Habit !== undefined ? { hp6Habit: goal.hp6Habit } : {}),
      dragKey: o.key,
      pinnedFromOverride: true,
      dragOverrideSaved: true,
      overrideSource: o.source ?? "drag"
    });
    keysPresent.add(o.key);
  }

  return [...blocks, ...extras].sort((a, b) => a.startMs - b.startMs);
}
