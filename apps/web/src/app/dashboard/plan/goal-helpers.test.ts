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
  it("shows max as — for floor-only goals that do not take remainder", () => {
    const g = baseGoal({ minMinutesPerWeek: 480 });
    const summary = summariseAllocation([g], 1000);
    const row = goalAllocationRowDisplay(g, summary, { loggedMinutes: 10, proposedFutureMinutes: 470 });
    expect(row.loggedLabel).toBe("10 min");
    expect(row.proposedLabel).toBe("7h 50m");
    expect(row.minTargetLabel).toBe("8h");
    expect(row.maxTargetLabel).toBe("—");
  });

  it("uses explicit weekly max for max target", () => {
    const g = baseGoal({ minMinutesPerWeek: 120, maxMinutesPerWeek: 600 });
    const summary = summariseAllocation([g], 5000);
    const row = goalAllocationRowDisplay(g, summary, { loggedMinutes: 30, proposedFutureMinutes: 90 });
    expect(row.loggedLabel).toBe("30 min");
    expect(row.proposedLabel).toBe("1h 30m");
    expect(row.minTargetLabel).toBe("2h");
    expect(row.maxTargetLabel).toBe("10h");
  });

  it("shows min only row with — max when no share cohort", () => {
    const g = baseGoal({ minMinutesPerWeek: 480 });
    const summary = summariseAllocation([g], 480);
    const row = goalAllocationRowDisplay(g, summary, { loggedMinutes: 0, proposedFutureMinutes: 480 });
    expect(row.minTargetLabel).toBe("8h");
    expect(row.maxTargetLabel).toBe("—");
  });

  it("shows equal-share upper hint for a single unconstrained goal", () => {
    const g = baseGoal();
    const summary = summariseAllocation([g], 420);
    const row = goalAllocationRowDisplay(g, summary, { loggedMinutes: 120, proposedFutureMinutes: 60 });
    expect(row.loggedLabel).toBe("2h");
    expect(row.proposedLabel).toBe("1h");
    expect(row.minTargetLabel).toBe("—");
    expect(row.maxTargetLabel).toBe("7h");
  });

  it("shows weighted remainder share for max target", () => {
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
    const row = goalAllocationRowDisplay(wt, summary, { loggedMinutes: 800, proposedFutureMinutes: 814 });
    expect(row.loggedLabel).toBe("13h 20m");
    expect(row.proposedLabel).toBe("13h 34m");
    expect(row.minTargetLabel).toBe("—");
    expect(row.maxTargetLabel).toBe(formatMinutes(wtHint));
  });
});
