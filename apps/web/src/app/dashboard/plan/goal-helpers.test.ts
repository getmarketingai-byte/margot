import { describe, expect, it } from "vitest";
import type { WeeklyGoal } from "@calendar-automations/schema";
import {
  formatMinutes,
  goalAllocationRowDisplay,
  summariseAllocation
} from "./goal-helpers";

function baseGoal(over: Partial<WeeklyGoal> = {}): WeeklyGoal {
  return {
    id: "goal-1",
    title: "Goal",
    energyMode: "neutral",
    energyPolarity: "neutral",
    attentionMode: "unspecified",
    workLayer: "unspecified",
    ppfHorizon: "unspecified",
    commitmentLevel: "committed",
    ...over
  };
}

describe("summariseAllocation", () => {
  it("applies allocationSharePercent to the post-floor remainder for hints", () => {
    const floor = baseGoal({ id: "floor", title: "Floored", minMinutesPerWeek: 120 });
    const eq = baseGoal({ id: "eq", title: "Equal share" });
    const wt = baseGoal({
      id: "wt",
      title: "40% row",
      allocationSharePercent: 40
    });
    const summary = summariseAllocation([floor, eq, wt], 614);
    expect(summary.reservedMinutes).toBe(120);
    expect(summary.remainingMinutes).toBe(494);
    // 40% of full-week T=614 → 245.6; rest of R=494 to equal row
    expect(summary.remainderHintByGoalId["wt"]).toBe(246);
    expect(summary.remainderHintByGoalId["eq"]).toBe(248);
    expect(summary.remainderHintByGoalId["floor"]).toBeUndefined();
  });
});

describe("goalAllocationRowDisplay", () => {
  it("omits upper hint for floor-only goals that do not take remainder", () => {
    const g = baseGoal({ minMinutesPerWeek: 480 });
    const summary = summariseAllocation([g], 1000);
    const { line } = goalAllocationRowDisplay(g, summary, 480);
    expect(line).toBe("8h / 8h");
  });

  it("uses explicit weekly max as the third segment", () => {
    const g = baseGoal({ minMinutesPerWeek: 120, maxMinutesPerWeek: 600 });
    const summary = summariseAllocation([g], 5000);
    const { line } = goalAllocationRowDisplay(g, summary, 200);
    expect(line).toBe("3h 20m / 2h - 10h");
  });

  it("omits third segment when there is no remainder cohort", () => {
    const g = baseGoal({ minMinutesPerWeek: 480 });
    const summary = summariseAllocation([g], 480);
    const { line } = goalAllocationRowDisplay(g, summary, 480);
    expect(line).toBe("8h / 8h");
  });

  it("shows equal-share upper hint for a single unconstrained goal", () => {
    const g = baseGoal();
    const summary = summariseAllocation([g], 420);
    const { line } = goalAllocationRowDisplay(g, summary, 120);
    expect(line).toBe("2h / — - 7h");
  });

  it("shows weighted remainder share, not an even split of the pool", () => {
    const floor = baseGoal({ id: "floor", title: "Floored", minMinutesPerWeek: 120 });
    const eq = baseGoal({ id: "eq", title: "Equal" });
    const wt = baseGoal({
      id: "wt",
      title: "Weighted",
      allocationSharePercent: 40
    });
    const summary = summariseAllocation([floor, eq, wt], 614);
    const wtHint = summary.remainderHintByGoalId["wt"]!;
    expect(wtHint).toBe(246);
    const { line } = goalAllocationRowDisplay(wt, summary, 1614);
    expect(line).toBe(`26h 54m / — - ${formatMinutes(wtHint)}`);
  });
});
