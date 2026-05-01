import { describe, expect, it } from "vitest";
import type { WeeklyGoal } from "@calendar-automations/schema";
import {
  goalAllocationRowDisplay,
  type GoalAllocationRowSummary
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

describe("goalAllocationRowDisplay", () => {
  it("shows min and equal-share hint for weekly min-only goals", () => {
    const summary: GoalAllocationRowSummary = {
      equalShareGoals: 1,
      perEqualShareMinutes: 667,
      hasWeightedShare: false
    };
    const { line } = goalAllocationRowDisplay(
      baseGoal({ minMinutesPerWeek: 480 }),
      summary,
      480
    );
    expect(line).toBe("8h / 8h - 11h 7m");
  });

  it("uses explicit weekly max as the third segment", () => {
    const summary: GoalAllocationRowSummary = {
      equalShareGoals: 0,
      perEqualShareMinutes: 0,
      hasWeightedShare: false
    };
    const { line } = goalAllocationRowDisplay(
      baseGoal({ minMinutesPerWeek: 120, maxMinutesPerWeek: 600 }),
      summary,
      200
    );
    expect(line).toBe("3h 20 min / 2h - 10h");
  });

  it("omits third segment when there is no cohort and no explicit max", () => {
    const summary: GoalAllocationRowSummary = {
      equalShareGoals: 0,
      perEqualShareMinutes: 0,
      hasWeightedShare: false
    };
    const { line } = goalAllocationRowDisplay(
      baseGoal({ minMinutesPerWeek: 480 }),
      summary,
      480
    );
    expect(line).toBe("8h / 8h");
  });

  it("shows unconstrained upper hint with em-dash minimum", () => {
    const summary: GoalAllocationRowSummary = {
      equalShareGoals: 1,
      perEqualShareMinutes: 420,
      hasWeightedShare: false
    };
    const { line } = goalAllocationRowDisplay(baseGoal(), summary, 120);
    expect(line).toBe("2h / — - 7h");
  });
});
