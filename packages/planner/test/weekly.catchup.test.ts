import { describe, expect, it } from "vitest";
import { allocateWeek } from "../src/weekly";
import { QUANTUM } from "../src/weekly-grid";
import type { WeeklyGoal, WeeklyPlan, UserSettings } from "@calendar-automations/schema";
import { DEFAULT_USER_SETTINGS, SETTINGS_SCHEMA_VERSION, weeklyGoalSchema } from "@calendar-automations/schema";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function buildSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return { ...DEFAULT_USER_SETTINGS, schemaVersion: SETTINGS_SCHEMA_VERSION, ...overrides };
}

function goalWithAllocationShare(id: string, pct: number): WeeklyGoal {
  return weeklyGoalSchema.parse({
    id,
    title: "Share row",
    priority: 3,
    allocationSharePercent: pct,
    energyMode: "neutral",
    ppfHorizon: "unspecified"
  });
}

const plan: WeeklyPlan = {
  id: "plan-catchup",
  weekStart: "2026-04-27",
  timezone: "UTC",
  goals: [
    {
      id: "goalA",
      title: "A",
      minMinutesPerWeek: 120,
      maxMinutesPerWeek: 240,
      energyMode: "neutral",
      energyPolarity: "neutral",
      attentionMode: "unspecified",
      workLayer: "unspecified",
      ppfHorizon: "unspecified"
    },
    {
      id: "goalB",
      title: "B",
      minMinutesPerWeek: 120,
      maxMinutesPerWeek: 240,
      energyMode: "neutral",
      energyPolarity: "neutral",
      attentionMode: "unspecified",
      workLayer: "unspecified",
      ppfHorizon: "unspecified"
    }
  ],
  overrides: []
};

const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);

describe("allocateWeek catchUpFloors", () => {
  it("baseline (no catch-up) places both goals within their bounds", () => {
    const result = allocateWeek({
      plan,
      busy: [],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    expect(result.metrics.perGoal.goalA!.targetMinutes).toBeGreaterThanOrEqual(120);
    expect(result.metrics.perGoal.goalB!.targetMinutes).toBeGreaterThanOrEqual(120);
    expect(result.metrics.perGoal.goalA!.scheduledMinutes).toBeGreaterThan(0);
    expect(result.metrics.perGoal.goalB!.scheduledMinutes).toBeGreaterThan(0);
  });

  it("raises goalA's target when catch-up increases its floor and time allows", () => {
    const looseCapPlan: WeeklyPlan = {
      ...plan,
      goals: [
        {
          ...plan.goals[0]!,
          minMinutesPerWeek: 120,
          maxMinutesPerWeek: 1000
        },
        {
          ...plan.goals[1]!,
          minMinutesPerWeek: 120,
          maxMinutesPerWeek: 1000
        }
      ]
    };
    const busy = Array.from({ length: 7 }, (_, d) => ({
      sourceId: `busy-${d}`,
      title: "blocked",
      startMs: weekStartMs + d * DAY_MS + 1 * HOUR_MS,
      endMs: weekStartMs + d * DAY_MS + 24 * HOUR_MS,
      busy: true,
      source: "internal" as const
    }));
    const baseline = allocateWeek({
      plan: looseCapPlan,
      busy,
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const boosted = allocateWeek({
      plan: looseCapPlan,
      busy,
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS,
      catchUpFloors: { goalA: 60 }
    });
    expect(boosted.metrics.perGoal.goalA!.targetMinutes).toBeGreaterThan(
      baseline.metrics.perGoal.goalA!.targetMinutes
    );
    expect(boosted.metrics.perGoal.goalA!.scheduledMinutes).toBeGreaterThanOrEqual(
      baseline.metrics.perGoal.goalA!.scheduledMinutes
    );
  });

  it("never schedules above maxMinutesPerWeek even with a large catch-up bump", () => {
    const boosted = allocateWeek({
      plan,
      busy: [],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS,
      catchUpFloors: { goalA: 500 }
    });
    expect(boosted.metrics.perGoal.goalA!.targetMinutes).toBeLessThanOrEqual(240);
    expect(boosted.metrics.perGoal.goalA!.scheduledMinutes).toBeLessThanOrEqual(240);
  });

  it("does not let catch-up raise allocationSharePercent above pct × weekCapacity", () => {
    const gid = "pct-cap-catchup";
    const pctPlan: WeeklyPlan = {
      id: "plan-pct-cap",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goals: [goalWithAllocationShare(gid, 50)],
      overrides: []
    };
    const base = allocateWeek({
      plan: pctPlan,
      busy: [],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const T = base.metrics.utilisation.weekCapacityMinutes;
    const shareCap = Math.round((0.5 * T) / QUANTUM) * QUANTUM;
    expect(base.metrics.perGoal[gid]!.targetMinutes).toBeLessThanOrEqual(shareCap);

    const bumped = allocateWeek({
      plan: pctPlan,
      busy: [],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS,
      catchUpFloors: { [gid]: 5000 }
    });
    expect(bumped.metrics.perGoal[gid]!.targetMinutes).toBeLessThanOrEqual(shareCap);
    expect(bumped.metrics.perGoal[gid]!.targetMinutes).toBe(base.metrics.perGoal[gid]!.targetMinutes);
  });

  it("does not affect goals that are not listed in catchUpFloors", () => {
    const baseline = allocateWeek({
      plan,
      busy: [],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const boosted = allocateWeek({
      plan,
      busy: [],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS,
      catchUpFloors: { goalA: 60 }
    });
    expect(boosted.metrics.perGoal.goalB!.targetMinutes).toBe(
      baseline.metrics.perGoal.goalB!.targetMinutes
    );
  });

  it("honours catch-up under proportional starvation when floors exceed free time", () => {
    // Squeeze available time so goal floors exceed it: only ~6h free per week.
    const busy = [
      ...Array.from({ length: 7 }, (_, d) => ({
        sourceId: `busy-${d}`,
        title: "blocked",
        startMs: weekStartMs + d * DAY_MS + 1 * HOUR_MS,
        endMs: weekStartMs + d * DAY_MS + 24 * HOUR_MS,
        busy: true
      }))
    ];
    const baseline = allocateWeek({
      plan,
      busy,
      settings: buildSettings({
        allocator: { starvationMode: "proportional", allocationMode: "even" }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const boosted = allocateWeek({
      plan,
      busy,
      settings: buildSettings({
        allocator: { starvationMode: "proportional", allocationMode: "even" }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS,
      catchUpFloors: { goalA: 60 }
    });
    expect(boosted.metrics.perGoal.goalB!.targetMinutes).toBe(
      baseline.metrics.perGoal.goalB!.targetMinutes
    );
    expect(boosted.metrics.perGoal.goalA!.targetMinutes).toBeGreaterThan(
      baseline.metrics.perGoal.goalA!.targetMinutes
    );
    expect(boosted.metrics.perGoal.goalA!.scheduledMinutes).toBeGreaterThanOrEqual(
      baseline.metrics.perGoal.goalA!.scheduledMinutes
    );
  });

  it("honours catch-up under strict starvation: goalA's floor pays first", () => {
    const busy = [
      ...Array.from({ length: 7 }, (_, d) => ({
        sourceId: `busy-${d}`,
        title: "blocked",
        startMs: weekStartMs + d * DAY_MS + 1 * HOUR_MS,
        endMs: weekStartMs + d * DAY_MS + 24 * HOUR_MS,
        busy: true
      }))
    ];
    const baseline = allocateWeek({
      plan,
      busy,
      settings: buildSettings({
        allocator: { starvationMode: "strict", allocationMode: "even" }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const boosted = allocateWeek({
      plan,
      busy,
      settings: buildSettings({
        allocator: { starvationMode: "strict", allocationMode: "even" }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS,
      catchUpFloors: { goalA: 60 }
    });
    expect(boosted.metrics.perGoal.goalA!.scheduledMinutes).toBeGreaterThan(
      baseline.metrics.perGoal.goalA!.scheduledMinutes
    );
  });

  it("treats undefined catchUpFloors as a no-op (legacy behaviour preserved)", () => {
    const baseline = allocateWeek({
      plan,
      busy: [],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const explicitEmpty = allocateWeek({
      plan,
      busy: [],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS,
      catchUpFloors: {}
    });
    expect(explicitEmpty.metrics.perGoal.goalA!.scheduledMinutes).toBe(
      baseline.metrics.perGoal.goalA!.scheduledMinutes
    );
    expect(explicitEmpty.metrics.perGoal.goalB!.scheduledMinutes).toBe(
      baseline.metrics.perGoal.goalB!.scheduledMinutes
    );
  });

  it("goal-local catch-up boosts one equal-share row without shrinking peer Pass‑2 targets", () => {
    const unconstrainedPair: WeeklyPlan = {
      id: "plan-eq-pair",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goals: [
        {
          id: "eqA",
          title: "A",
          energyMode: "neutral",
          energyPolarity: "neutral",
          attentionMode: "unspecified",
          workLayer: "unspecified",
          ppfHorizon: "unspecified"
        },
        {
          id: "eqB",
          title: "B",
          energyMode: "neutral",
          energyPolarity: "neutral",
          attentionMode: "unspecified",
          workLayer: "unspecified",
          ppfHorizon: "unspecified"
        }
      ],
      overrides: []
    };
    const baseline = allocateWeek({
      plan: unconstrainedPair,
      busy: [],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const withCatchUp = allocateWeek({
      plan: unconstrainedPair,
      busy: [],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS,
      catchUpFloors: { eqA: 120 }
    });
    expect(withCatchUp.metrics.perGoal.eqB!.targetMinutes).toBe(
      baseline.metrics.perGoal.eqB!.targetMinutes
    );
    expect(withCatchUp.metrics.perGoal.eqA!.targetMinutes).toBeGreaterThan(
      baseline.metrics.perGoal.eqA!.targetMinutes
    );
  });
});
