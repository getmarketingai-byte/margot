import { describe, expect, it } from "vitest";
import { allocateWeek } from "../src/weekly";
import type { WeeklyPlan, UserSettings } from "@calendar-automations/schema";
import { DEFAULT_USER_SETTINGS, SETTINGS_SCHEMA_VERSION } from "@calendar-automations/schema";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function buildSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return { ...DEFAULT_USER_SETTINGS, schemaVersion: SETTINGS_SCHEMA_VERSION, ...overrides };
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
    // goalA should grow at goalB's expense under proportional mode.
    expect(boosted.metrics.perGoal.goalA!.scheduledMinutes).toBeGreaterThan(
      baseline.metrics.perGoal.goalA!.scheduledMinutes
    );
    expect(boosted.metrics.perGoal.goalB!.scheduledMinutes).toBeLessThanOrEqual(
      baseline.metrics.perGoal.goalB!.scheduledMinutes
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
});
