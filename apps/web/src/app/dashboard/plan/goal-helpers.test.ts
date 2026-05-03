import { describe, expect, it } from "vitest";
import type { GoalGroup, WeeklyGoal } from "@calendar-automations/schema";
import {
  aggregateGroupConstraintSummariesForGoal,
  formatMinutes,
  goalAllocationRowDisplay,
  goalExceedsDeclaredWeekShare,
  goalGroupAggregateSummaryLine,
  goalPlannerPercentOfSchedulableWeek,
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

describe("goalPlannerPercentOfSchedulableWeek", () => {
  it("returns null when free time is not positive", () => {
    expect(goalPlannerPercentOfSchedulableWeek(120, 0)).toBeNull();
    expect(goalPlannerPercentOfSchedulableWeek(120, -10)).toBeNull();
  });

  it("returns null when target is missing or non-positive", () => {
    expect(goalPlannerPercentOfSchedulableWeek(undefined, 600)).toBeNull();
    expect(goalPlannerPercentOfSchedulableWeek(0, 600)).toBeNull();
  });

  it("rounds target minutes as a percent of free minutes", () => {
    expect(goalPlannerPercentOfSchedulableWeek(150, 600)).toBe(25);
  });

  it("caps at 100%", () => {
    expect(goalPlannerPercentOfSchedulableWeek(900, 600)).toBe(100);
  });
});

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

  it("includes daily-only floors in Pass-2 remainder hints (matches planner)", () => {
    const daily = baseGoal({
      id: "daily",
      title: "Neutrino-like",
      minMinutesPerDay: 30
    });
    const share = baseGoal({ id: "share", title: "Peer" });
    const summary = summariseAllocation([daily, share], 1000);
    expect(summary.remainderHintByGoalId["daily"]).toBeDefined();
    expect(summary.remainderHintByGoalId["share"]).toBeDefined();
    expect(summary.reservedMinutes).toBe(30 * 7);
  });
});

describe("goalExceedsDeclaredWeekShare", () => {
  it("uses remainder hint vs inflated equalSlice when % rows share the cohort", () => {
    const floor = baseGoal({ id: "floor", title: "Floored", minMinutesPerWeek: 120 });
    const eq = baseGoal({ id: "eq", title: "Equal share" });
    const wt = baseGoal({
      id: "wt",
      title: "40% row",
      allocationSharePercent: 40
    });
    const summary = summariseAllocation([floor, eq, wt], 614);
    const hintEq = summary.remainderHintByGoalId["eq"]!;
    const hintWt = summary.remainderHintByGoalId["wt"]!;
    expect(hintEq).toBe(248);
    expect(hintWt).toBe(246);
    expect(summary.equalSliceOfWeekMinutes).toBe(307);
    expect(goalExceedsDeclaredWeekShare(eq, summary, hintEq)).toBe(false);
    expect(goalExceedsDeclaredWeekShare(wt, summary, hintWt)).toBe(false);
    expect(goalExceedsDeclaredWeekShare(wt, summary, hintWt + 20)).toBe(true);
    expect(summary.hasWeightedShare).toBe(true);
  });

  it("flags when target exceeds remainder hint (all equal-share cohort)", () => {
    const a = baseGoal({ id: "a", title: "A" });
    const b = baseGoal({ id: "b", title: "B" });
    const c = baseGoal({ id: "c", title: "C" });
    const summary = summariseAllocation([a, b, c], 600);
    const hintA = summary.remainderHintByGoalId["a"]!;
    expect(hintA).toBe(200);
    expect(goalExceedsDeclaredWeekShare(a, summary, hintA)).toBe(false);
    expect(goalExceedsDeclaredWeekShare(a, summary, hintA + 20)).toBe(true);
  });

  it("falls back to perEqualShareMinutes when no per-goal hint", () => {
    const a = baseGoal({ id: "a", title: "A" });
    const b = baseGoal({ id: "b", title: "B" });
    const summary = summariseAllocation([a, b], 600);
    expect(summary.perEqualShareMinutes).toBe(300);
    expect(goalExceedsDeclaredWeekShare(a, summary, 300)).toBe(false);
    expect(goalExceedsDeclaredWeekShare(a, summary, 316)).toBe(true);
  });

  it("does not warn when displayed target is high only because of day-sheet logs (allocator credit)", () => {
    const a = baseGoal({ id: "a", title: "A" });
    const b = baseGoal({ id: "b", title: "B" });
    const c = baseGoal({ id: "c", title: "C" });
    const summary = summariseAllocation([a, b, c], 600);
    const hintA = summary.remainderHintByGoalId["a"]!;
    expect(hintA).toBe(200);
    // Full Pass 1+2 style display can stay at 200+64 while comparable demand is 200.
    expect(goalExceedsDeclaredWeekShare(a, summary, hintA + 64, 64)).toBe(false);
    expect(goalExceedsDeclaredWeekShare(a, summary, hintA + 80, 64)).toBe(true);
  });

  it("uses allocator pre–Pass 3 demand when provided (display target can stay full-week)", () => {
    const a = baseGoal({ id: "a", title: "A" });
    const summary = summariseAllocation([a], 600);
    expect(summary.remainderHintByGoalId["a"]).toBe(600);
    // Display can stay 700 while demand (aligned to hints) is 600.
    expect(goalExceedsDeclaredWeekShare(a, summary, 700, 0, 600)).toBe(false);
    expect(goalExceedsDeclaredWeekShare(a, summary, 700, 0, 620)).toBe(true);
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
