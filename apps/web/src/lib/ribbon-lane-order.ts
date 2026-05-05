import type { WeeklyGoal } from "@calendar-automations/schema";
import type { SystemBlock } from "@/lib/week-blocks";

/**
 * Distinct horizontal lane for invert-calendar vs stacked ribbons. Same scheduling goal can have
 * both layers visible in stacked mode; sharing only `goalId` would pin them to one x-offset.
 */
export function ribbonLaneKey(
  block: Pick<SystemBlock, "system" | "invertedGoalId" | "stackedGoalId">
): string | null {
  if (block.system === "inverted-timemap" && block.invertedGoalId) return `inv:${block.invertedGoalId}`;
  if (block.system === "stacked-timemap" && block.stackedGoalId) return `stk:${block.stackedGoalId}`;
  return null;
}

/** Matches allocator Pass‑3 tier ordering (`weekly.ts` `commitmentRank`). */
function commitmentTierRank(level: WeeklyGoal["commitmentLevel"] | undefined): number {
  switch (level) {
    case "non_negotiable":
      return 0;
    case "nice_to_have":
      return 2;
    default:
      return 1;
  }
}

function parseRibbonLaneKey(laneKey: string): { kind: 0 | 1; goalId: string } {
  if (laneKey.startsWith("inv:")) return { kind: 0, goalId: laneKey.slice("inv:".length) };
  if (laneKey.startsWith("stk:")) return { kind: 1, goalId: laneKey.slice("stk:".length) };
  return { kind: 0, goalId: laneKey };
}

/**
 * Left-to-right ribbon order: higher scheduling priority first (non‑negotiable → committed → nice‑to‑have),
 * then Perfect Week list order, then invert-calendar lane before stacked for the same goal.
 *
 * For per-goal UI lists (legend, toggles), compare `inv:${goalId}` vs `inv:${goalId}` so ordering follows
 * commitment + plan row order.
 */
export function compareRibbonLaneKeysPriority(
  aKey: string,
  bKey: string,
  orderedGoals: readonly WeeklyGoal[] | undefined
): number {
  const pa = parseRibbonLaneKey(aKey);
  const pb = parseRibbonLaneKey(bKey);
  const goals = orderedGoals ?? [];
  const idxA = goals.findIndex((g) => g.id === pa.goalId);
  const idxB = goals.findIndex((g) => g.id === pb.goalId);
  const tierA = commitmentTierRank(idxA >= 0 ? goals[idxA]!.commitmentLevel : undefined);
  const tierB = commitmentTierRank(idxB >= 0 ? goals[idxB]!.commitmentLevel : undefined);
  if (tierA !== tierB) return tierA - tierB;
  const orderA = idxA >= 0 ? idxA : Number.MAX_SAFE_INTEGER;
  const orderB = idxB >= 0 ? idxB : Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  if (pa.kind !== pb.kind) return pa.kind - pb.kind;
  return aKey.localeCompare(bKey);
}
