import { describe, expect, it } from "vitest";
import { weeklyGoalSchema } from "../src/goals";

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
});
