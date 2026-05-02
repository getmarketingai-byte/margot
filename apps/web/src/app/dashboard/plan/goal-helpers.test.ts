import { describe, expect, it } from "vitest";
import type { GoalGroup, WeeklyGoal } from "@calendar-automations/schema";
import {
  aggregateGroupConstraintSummariesForGoal,
  formatMinutes,
  goalAllocationRowDisplay,
  goalGroupAggregateSummaryLine,
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
    expect(summary.hasAnyGoalGroupMembership).toBe(false);
  });

  it("sets hasAnyGoalGroupMembership when a goal references groupIds", () => {
    const g = baseGoal({ groupIds: ["grp-a"] });
    const summary = summariseAllocation([g], 100);
    expect(summary.hasAnyGoalGroupMembership).toBe(true);
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

  it("uses planner weekly target for max when provided", () => {
    const g = baseGoal();
    const summary = summariseAllocation([g], 420);
    const row = goalAllocationRowDisplay(
      g,
      summary,
      { loggedMinutes: 0, proposedFutureMinutes: 0 },
      180
    );
    expect(row.maxTargetLabel).toBe("3h");
    expect(row.title).toContain("allocator weekly target");
  });

  it("explains when planner target is below field-only heuristic", () => {
    const g = baseGoal();
    const summary = summariseAllocation([g], 420);
    const row = goalAllocationRowDisplay(
      g,
      summary,
      { loggedMinutes: 0, proposedFutureMinutes: 0 },
      100
    );
    expect(row.maxTargetLabel).toBe("1h 40m");
    expect(row.title.toLowerCase()).toMatch(/hint|cohort|ignore/);
  });
});

describe("goalGroupAggregateSummaryLine", () => {
  it("returns null when the group sets no scheduling fields", () => {
    const grp: GoalGroup = { id: "x", title: "Empty" };
    expect(goalGroupAggregateSummaryLine(grp)).toBeNull();
  });

  it("joins aggregate parts with middots", () => {
    const grp: GoalGroup = {
      id: "g1",
      title: "Screens",
      maxMinutesPerWeek: 120,
      maxMinutesPerDay: 45
    };
    const line = goalGroupAggregateSummaryLine(grp);
    expect(line).toContain("∑");
    expect(line).toContain("≤");
    expect(line).toContain("/wk");
    expect(line).toContain("/day");
  });
});

describe("aggregateGroupConstraintSummariesForGoal", () => {
  it("returns per-group lines for the goal's cohorts", () => {
    const grp: GoalGroup = {
      id: "g1",
      title: "Screens",
      allocationSharePercent: 25
    };
    const goal = baseGoal({ groupIds: ["g1"] });
    const rows = aggregateGroupConstraintSummariesForGoal(goal, [grp]);
    expect(rows).toEqual([
      expect.objectContaining({
        groupId: "g1",
        line: expect.stringContaining("Screens") as string
      })
    ]);
    expect(rows[0]!.line).toContain("∑ 25% of week");
  });
});
