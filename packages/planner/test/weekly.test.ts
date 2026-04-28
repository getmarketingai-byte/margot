import { describe, expect, it } from "vitest";
import { allocateWeek } from "../src/weekly";
import type { WeeklyPlan, UserSettings } from "@calendar-automations/schema";
import { DEFAULT_USER_SETTINGS, SETTINGS_SCHEMA_VERSION } from "@calendar-automations/schema";
import type { BusyEvent } from "../src/types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function buildSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return { ...DEFAULT_USER_SETTINGS, schemaVersion: SETTINGS_SCHEMA_VERSION, ...overrides };
}

const plan: WeeklyPlan = {
  id: "plan-1",
  weekStart: "2026-04-27",
  timezone: "UTC",
  goals: [
    {
      id: "g1",
      title: "Deep coding",
      targetMinutes: 240,
      priority: 5,
      energyMode: "hyperfocus",
      ppfPillar: "professional",
      ppfHorizon: "y1"
    },
    {
      id: "g2",
      title: "Email triage",
      targetMinutes: 120,
      priority: 2,
      energyMode: "hyperaware",
      ppfPillar: "professional",
      ppfHorizon: "unspecified"
    },
    {
      id: "g3",
      title: "Family dinner",
      targetMinutes: 90,
      dayOfWeek: "friday",
      priority: 4,
      energyMode: "neutral",
      wheelAreaId: "relationships",
      ppfPillar: "personal",
      ppfHorizon: "unspecified",
      earliestHour: 18,
      latestHour: 21
    }
  ]
};

describe("allocateWeek", () => {
  it("places goals into free gaps and reports per-goal scheduled minutes", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const busy: BusyEvent[] = [];
    const result = allocateWeek({
      plan,
      busy,
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.metrics.perGoal["g1"]!.targetMinutes).toBe(240);
    expect(result.metrics.perGoal["g3"]!.scheduledMinutes).toBeGreaterThan(0);
  });

  it("computes PPF mix percentages across allocated time", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const result = allocateWeek({
      plan,
      busy: [],
      settings: buildSettings({
        ppf: {
          enabled: true,
          targets: [
            { pillar: "professional", minPercent: 50, minTouchesPerWeek: 0 },
            { pillar: "personal", minPercent: 10, minTouchesPerWeek: 0 },
            { pillar: "financial", minPercent: 0, minTouchesPerWeek: 0 }
          ]
        }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const sum =
      result.metrics.ppfPercent.personal +
      result.metrics.ppfPercent.professional +
      result.metrics.ppfPercent.financial;
    expect(sum).toBeGreaterThan(0);
    expect(sum).toBeLessThanOrEqual(100);
  });

  it("respects day-pinned goals (Friday dinner only on Friday)", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0); // Mon
    const result = allocateWeek({
      plan,
      busy: [],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const dinnerBlocks = result.blocks.filter((b) => b.goalId === "g3");
    for (const b of dinnerBlocks) {
      const dayIdx = Math.floor((b.startMs - weekStartMs) / DAY_MS);
      expect(dayIdx).toBe(4); // Friday is day 4 (0=Mon)
    }
  });

  it("respects multi-day pinning when daysOfWeek is set", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0); // Mon
    const result = allocateWeek({
      plan: {
        id: "multi-day",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          {
            id: "md",
            title: "Multi-day goal",
            targetMinutes: 180,
            daysOfWeek: ["tuesday", "thursday"],
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          }
        ]
      },
      busy: [],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const blocks = result.blocks.filter((b) => b.goalId === "md");
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      const dayIdx = Math.floor((b.startMs - weekStartMs) / DAY_MS);
      expect([1, 3]).toContain(dayIdx); // Tue or Thu only
    }
  });

  it("equal-shares free time across constraint-free goals", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const result = allocateWeek({
      plan: {
        id: "equal",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          { id: "a", title: "A", priority: 3, energyMode: "neutral", ppfHorizon: "unspecified" },
          { id: "b", title: "B", priority: 3, energyMode: "neutral", ppfHorizon: "unspecified" },
          { id: "c", title: "C", priority: 3, energyMode: "neutral", ppfHorizon: "unspecified" }
        ]
      },
      busy: [],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const targets = ["a", "b", "c"].map((id) => result.metrics.perGoal[id]!.targetMinutes);
    const max = Math.max(...targets);
    const min = Math.min(...targets);
    expect(max - min).toBeLessThanOrEqual(15);
    expect(min).toBeGreaterThan(0);
  });

  it("honours minMinutesPerWeek as a floor before equal-share", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const result = allocateWeek({
      plan: {
        id: "floor",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          {
            id: "admin",
            title: "Admin",
            minMinutesPerWeek: 300,
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          },
          {
            id: "free",
            title: "Free",
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          }
        ]
      },
      busy: [],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    expect(result.metrics.perGoal["admin"]!.targetMinutes).toBeGreaterThanOrEqual(300);
  });

  it("clamps daily allocation to maxMinutesPerDay", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const result = allocateWeek({
      plan: {
        id: "cap",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          {
            id: "admin",
            title: "Admin",
            minMinutesPerWeek: 600,
            maxMinutesPerDay: 60,
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          }
        ]
      },
      busy: [],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const adminBlocks = result.blocks.filter((b) => b.goalId === "admin");
    const byDay: Record<number, number> = {};
    for (const b of adminBlocks) {
      const dayIdx = Math.floor((b.startMs - weekStartMs) / DAY_MS);
      const mins = (b.endMs - b.startMs) / 60_000;
      byDay[dayIdx] = (byDay[dayIdx] ?? 0) + mins;
    }
    for (const mins of Object.values(byDay)) {
      expect(mins).toBeLessThanOrEqual(60);
    }
  });

  it("applies weekly and daily caps together when both are set", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const result = allocateWeek({
      plan: {
        id: "dual-cap",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          {
            id: "bounded",
            title: "Bounded",
            minMinutesPerWeek: 900,
            maxMinutesPerWeek: 300,
            maxMinutesPerDay: 60,
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          }
        ]
      },
      busy: [],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });

    const target = result.metrics.perGoal["bounded"]!.targetMinutes;
    expect(target).toBeLessThanOrEqual(300);

    const byDay: Record<number, number> = {};
    for (const b of result.blocks.filter((block) => block.goalId === "bounded")) {
      const dayIdx = Math.floor((b.startMs - weekStartMs) / DAY_MS);
      const mins = (b.endMs - b.startMs) / 60_000;
      byDay[dayIdx] = (byDay[dayIdx] ?? 0) + mins;
    }
    for (const mins of Object.values(byDay)) {
      expect(mins).toBeLessThanOrEqual(60);
    }
  });

  it("flags overcommitment when floors exceed available time (proportional default)", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    // One day's worth of busy events for all 7 days to drastically reduce free time.
    const busy: BusyEvent[] = [];
    for (let d = 0; d < 7; d++) {
      busy.push({
        id: `b${d}`,
        startMs: weekStartMs + d * DAY_MS + 0,
        endMs: weekStartMs + d * DAY_MS + 23 * HOUR_MS,
        busy: true
      });
    }
    const result = allocateWeek({
      plan: {
        id: "starved",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          {
            id: "a",
            title: "A",
            minMinutesPerWeek: 600,
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          },
          {
            id: "b",
            title: "B",
            minMinutesPerWeek: 600,
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          }
        ]
      },
      busy,
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    expect(result.metrics.overcommitted).toBeDefined();
    expect(result.metrics.overcommitted!.mode).toBe("proportional");
    expect(result.metrics.overcommitted!.neededMin).toBeGreaterThan(
      result.metrics.overcommitted!.availableMin
    );
  });
});
