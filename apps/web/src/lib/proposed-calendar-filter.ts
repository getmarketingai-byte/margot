import type { AllocatedBlock } from "@calendar-automations/planner";
import {
  calendarBusyModeForSource,
  isInvertedTimemapGoal,
  normaliseCalendarSource,
  type CalendarSource,
  type WeeklyPlan
} from "@calendar-automations/schema";

/**
 * Perfect Week calendar "proposed" layer is for schedulable commitments.
 * Inverted free/busy time maps are a readout layer (like weather) — hide them here.
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
