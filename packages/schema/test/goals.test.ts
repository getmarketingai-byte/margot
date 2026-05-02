import { describe, expect, it } from "vitest";
import {
  blockOverrideSchema,
  effectiveEnergyBatteryProfile,
  goalGroupSchema,
  normaliseGoalTime,
  sanitizeWeeklyPlanGoalGroupRefs,
  stubWeeklyGoalFromGoalGroup,
  weeklyGoalSchema,
  weeklyPlanSchema
} from "../src/goals";

describe("WeeklyGoal energy classification fields", () => {
  it("effectiveEnergyBatteryProfile uses explicit charge/drain when set", () => {
    const g = weeklyGoalSchema.parse({
      id: "g1",
      title: "Focus block",
      energyChargeImpact: 0.9,
      energyDrainImpact: 0.1
    });
    const p = effectiveEnergyBatteryProfile(g);
    expect(p.charge).toBe(0.9);
    expect(p.drain).toBe(0.1);
  });

  it("defaults the new energy/attention/workLayer fields when omitted", () => {
    const parsed = weeklyGoalSchema.parse({ id: "g1", title: "Deep work" });
    expect(parsed.energyPolarity).toBe("neutral");
    expect(parsed.attentionMode).toBe("unspecified");
    expect(parsed.workLayer).toBe("unspecified");
    // Existing fields keep their defaults.
    expect(parsed.energyMode).toBe("neutral");
    expect(parsed.ppfHorizon).toBe("unspecified");
  });

  it("round-trips explicit polarity/attention/workLayer values", () => {
    const parsed = weeklyGoalSchema.parse({
      id: "g1",
      title: "Ship feature",
      energyPolarity: "energise",
      attentionMode: "hyperfocus",
      workLayer: "needle-mover"
    });
    expect(parsed.energyPolarity).toBe("energise");
    expect(parsed.attentionMode).toBe("hyperfocus");
    expect(parsed.workLayer).toBe("needle-mover");
  });

  it("rejects unknown enum values", () => {
    expect(() =>
      weeklyGoalSchema.parse({ id: "g1", title: "x", energyPolarity: "boost" })
    ).toThrow();
    expect(() =>
      weeklyGoalSchema.parse({ id: "g1", title: "x", attentionMode: "scattered" })
    ).toThrow();
    expect(() =>
      weeklyGoalSchema.parse({ id: "g1", title: "x", workLayer: "deep-work" })
    ).toThrow();
  });

  it("accepts goals stored before the new fields existed (legacy round-trip)", () => {
    // Simulate a goal blob persisted by an older version of the app that
    // never wrote the new fields; the schema must default them in.
    const legacy = {
      id: "legacy-1",
      title: "Legacy goal",
      targetMinutes: 120,
      priority: 3,
      energyMode: "hyperfocus",
      ppfHorizon: "unspecified"
    };
    const parsed = weeklyGoalSchema.parse(legacy);
    expect(parsed.energyPolarity).toBe("neutral");
    expect(parsed.attentionMode).toBe("unspecified");
    expect(parsed.workLayer).toBe("unspecified");
  });

  it("drops legacy specialGoalType errands (use a normal goal instead)", () => {
    const parsed = weeklyGoalSchema.parse({
      id: "g1",
      title: "Shop",
      specialGoalType: "errands"
    });
    expect(parsed.specialGoalType).toBeUndefined();
  });

  it("round-trips allocationSharePercent", () => {
    const parsed = weeklyGoalSchema.parse({
      id: "g1",
      title: "Weighted",
      allocationSharePercent: 40
    });
    expect(parsed.allocationSharePercent).toBe(40);
  });

  it("treats targetMinutes-only as equal-share (no weekly min/max)", () => {
    const norm = normaliseGoalTime(
      weeklyGoalSchema.parse({
        id: "g1",
        title: "Quick add",
        targetMinutes: 180,
        priority: 3,
        energyMode: "neutral",
        ppfHorizon: "unspecified"
      })
    );
    expect(norm.isEqualShare).toBe(true);
    expect(norm.minMinutesPerWeek).toBeUndefined();
    expect(norm.maxMinutesPerWeek).toBeUndefined();
    expect(norm.isLegacyTarget).toBe(true);
  });

  it("sets isEqualShare false when only allocationSharePercent is set", () => {
    const goal = weeklyGoalSchema.parse({
      id: "g1",
      title: "Share only",
      allocationSharePercent: 25
    });
    expect(normaliseGoalTime(goal).isEqualShare).toBe(false);
  });

  it("does not derive maxMinutesPerWeek from maxMinutesPerDay alone", () => {
    const goal = weeklyGoalSchema.parse({
      id: "g1",
      title: "Capped per day only",
      maxMinutesPerDay: 480
    });
    const norm = normaliseGoalTime(goal);
    expect(norm.maxMinutesPerWeek).toBeUndefined();
    expect(norm.maxMinutesPerDay).toBe(480);
  });
  it("derives min/week from min/day × 7 when cadence is unconstrained", () => {
    const norm = normaliseGoalTime(
      weeklyGoalSchema.parse({
        id: "g1",
        title: "Gym",
        minMinutesPerDay: 60
      })
    );
    expect(norm.minMinutesPerWeek).toBe(420);
    expect(norm.minMinutesPerDay).toBe(60);
  });

  it("derives min/week from min/day when frequency is explicit", () => {
    const norm = normaliseGoalTime(
      weeklyGoalSchema.parse({
        id: "g1",
        title: "Gym",
        minMinutesPerDay: 45,
        frequencyPerWeek: 3
      })
    );
    expect(norm.minMinutesPerWeek).toBe(135);
  });

  it("derives min/week from pinned weekdays when frequency is absent", () => {
    const norm = normaliseGoalTime(
      weeklyGoalSchema.parse({
        id: "g1",
        title: "Gym",
        minMinutesPerDay: 30,
        daysOfWeek: ["monday", "wednesday"]
      })
    );
    expect(norm.minMinutesPerWeek).toBe(60);
  });
});

describe("GoalGroup & weekly plan group refs", () => {
  it("round-trips goalGroupSchema scheduling fields", () => {
    const g = goalGroupSchema.parse({
      id: "grp-1",
      title: "Screen time",
      allocationSharePercent: 35,
      maxMinutesPerDay: 90
    });
    expect(g.id).toBe("grp-1");
    expect(g.allocationSharePercent).toBe(35);
    expect(g.maxMinutesPerDay).toBe(90);
  });

  it("stubWeeklyGoalFromGoalGroup applies neutral framework defaults for allocator reuse", () => {
    const stub = stubWeeklyGoalFromGoalGroup(
      goalGroupSchema.parse({
        id: "grp-stub",
        title: "Stub group",
        maxMinutesPerWeek: 400
      })
    );
    expect(stub.id).toBe("grp-stub");
    expect(stub.title).toBe("Stub group");
    expect(stub.maxMinutesPerWeek).toBe(400);
    expect(stub.energyMode).toBe("neutral");
    expect(stub.ppfHorizon).toBe("unspecified");
  });

  it("sanitizeWeeklyPlanGoalGroupRefs drops unknown groupIds", () => {
    const raw = weeklyPlanSchema.parse({
      id: "w1",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goalGroups: [{ id: "keep", title: "K", maxMinutesPerDay: 60 }],
      goals: [
        weeklyGoalSchema.parse({
          id: "g1",
          title: "A",
          groupIds: ["keep", "gone"]
        })
      ]
    });
    const cleaned = sanitizeWeeklyPlanGoalGroupRefs(raw);
    expect(cleaned.goals[0]!.groupIds).toEqual(["keep"]);
  });

  it("defaults deletedGoals to empty when omitted", () => {
    const parsed = weeklyPlanSchema.parse({
      id: "w1",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goals: []
    });
    expect(parsed.deletedGoals).toEqual([]);
  });

  it("sanitizeWeeklyPlanGoalGroupRefs drops unknown groupIds on trashed goals", () => {
    const raw = weeklyPlanSchema.parse({
      id: "w1",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goalGroups: [{ id: "keep", title: "K", maxMinutesPerDay: 60 }],
      goals: [],
      deletedGoals: [
        {
          goal: weeklyGoalSchema.parse({
            id: "g-trash",
            title: "Old",
            groupIds: ["keep", "gone"]
          }),
          deletedAtMs: 1_700_000_000_000
        }
      ]
    });
    const cleaned = sanitizeWeeklyPlanGoalGroupRefs(raw);
    expect(cleaned.deletedGoals[0]!.goal.groupIds).toEqual(["keep"]);
  });
});

describe("blockOverrideSchema", () => {
  it("accepts kind goal with planner-style key", () => {
    const parsed = blockOverrideSchema.parse({
      kind: "goal",
      key: "goal:2026-04-28:0:uuid-here",
      startMs: 1_000,
      endMs: 2_000,
      setAt: 99
    });
    expect(parsed.kind).toBe("goal");
    expect(parsed.source).toBe("drag");
  });
});
