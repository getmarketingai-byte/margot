import type { AllocatedBlock } from "@calendar-automations/planner";
import {
  calendarBusyModeForSource,
  isInvertedTimemapGoal,
  normaliseCalendarSource,
  type CalendarSource,
  type WeeklyPlan
} from "@calendar-automations/schema";

/**
 * Allocator blocks for schedulable commitments only.
 * Inverted free/busy time maps are a readout layer (like weather) — omit from
 * Perfect Week "proposed" preview and from ICS snapshot events.
 */
export function filterInvertedTimemapFromProposedBlocks(
  blocks: readonly AllocatedBlock[],
  plan: Pick<WeeklyPlan, "goals">,
  calendarSources: readonly CalendarSource[]
): AllocatedBlock[] {
  const hidden = new Set<string>();
  for (const g of plan.goals) {
    if (isInvertedTimemapGoal(g)) hidden.add(g.id);
  }
  for (const src of calendarSources) {
    const n = normaliseCalendarSource(src);
    if (calendarBusyModeForSource(n) === "invert-free-busy" && n.availabilityGoalId) {
      hidden.add(n.availabilityGoalId);
    }
  }
  return blocks.filter((b) => !hidden.has(b.goalId));
}
