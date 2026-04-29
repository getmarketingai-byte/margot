import { describe, expect, it } from "vitest";
import { blockOverrideSchema, normaliseGoalTime, weeklyGoalSchema } from "../src/goals";

describe("WeeklyGoal energy classification fields", () => {
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
  it("does not inflate min/week from min/day when cadence is unconstrained", () => {
    const norm = normaliseGoalTime(
      weeklyGoalSchema.parse({
        id: "g1",
        title: "Gym",
        minMinutesPerDay: 60
      })
    );
    expect(norm.minMinutesPerWeek).toBeUndefined();
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
