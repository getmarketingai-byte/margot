import { describe, expect, it } from "vitest";
import {
  allocateWeek,
  buildGoalDragKey,
  computeAllocationRemainderFractions
} from "../src/weekly";
import type { WeeklyGoal, WeeklyPlan, UserSettings } from "@calendar-automations/schema";
import { DEFAULT_USER_SETTINGS, SETTINGS_SCHEMA_VERSION, weeklyGoalSchema } from "@calendar-automations/schema";
import type { BusyEvent } from "../src/types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function buildSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return { ...DEFAULT_USER_SETTINGS, schemaVersion: SETTINGS_SCHEMA_VERSION, ...overrides };
}

function goal(p: Partial<WeeklyGoal> & Pick<WeeklyGoal, "id" | "title">): WeeklyGoal {
  return weeklyGoalSchema.parse({
    priority: 3,
    energyMode: "neutral",
    ppfHorizon: "unspecified",
    ...p
  });
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
  it("scheduleInNiceWeather limits placement to nice-weather windows", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const monday9 = weekStartMs + 9 * HOUR_MS;
    const monday11 = weekStartMs + 11 * HOUR_MS;
    const niceWeatherWindows = [{ startMs: monday9, endMs: monday11 }];
    const outdoor = goal({
      id: "out-walk",
      title: "Walk",
      minMinutesPerWeek: 45,
      scheduleInNiceWeather: true
    });
    const soloPlan: WeeklyPlan = {
      id: "plan-weather",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goals: [outdoor],
      overrides: [],
      weeklyIntent: { hp6Focus: [] }
    };
    const result = allocateWeek({
      plan: soloPlan,
      busy: [],
      niceWeatherWindows,
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS,
      weekAnchorDate: "2026-04-27"
    });
    expect(result.metrics.perGoal["out-walk"]!.scheduledMinutes).toBeGreaterThan(0);
    for (const b of result.blocks) {
      expect(b.startMs).toBeGreaterThanOrEqual(monday9);
      expect(b.endMs).toBeLessThanOrEqual(monday11);
    }
  });

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

  it("even mode spreads slack in a free window as equal buffers between goals", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const tuesdayStart = weekStartMs + DAY_MS;
    const busy: BusyEvent[] = [
      {
        id: "b1",
        startMs: tuesdayStart,
        endMs: tuesdayStart + 12 * HOUR_MS,
        busy: true
      },
      {
        id: "b2",
        startMs: tuesdayStart + 18 * HOUR_MS,
        endMs: tuesdayStart + DAY_MS,
        busy: true
      }
    ];
    const result = allocateWeek({
      plan: {
        id: "even-buffers",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          {
            id: "a",
            title: "A",
            daysOfWeek: ["tuesday"],
            maxMinutesPerWeek: 60,
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          },
          {
            id: "b",
            title: "B",
            daysOfWeek: ["tuesday"],
            maxMinutesPerWeek: 60,
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          },
          {
            id: "c",
            title: "C",
            daysOfWeek: ["tuesday"],
            maxMinutesPerWeek: 60,
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          }
        ]
      },
      busy,
      settings: buildSettings({
        allocator: { starvationMode: "proportional", allocationMode: "even" }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });

    const tuesdayEnd = tuesdayStart + DAY_MS;
    const tuesdayBlocks = result.blocks
      .filter((b) => !b.segment && b.startMs >= tuesdayStart && b.endMs <= tuesdayEnd)
      .sort((a, b) => a.startMs - b.startMs);

    expect(tuesdayBlocks.length).toBe(3);
    const windowStart = tuesdayStart + 12 * HOUR_MS;
    const windowEnd = tuesdayStart + 18 * HOUR_MS;
    const gapsMin = [
      (tuesdayBlocks[0]!.startMs - windowStart) / 60_000,
      (tuesdayBlocks[1]!.startMs - tuesdayBlocks[0]!.endMs) / 60_000,
      (tuesdayBlocks[2]!.startMs - tuesdayBlocks[1]!.endMs) / 60_000,
      (windowEnd - tuesdayBlocks[2]!.endMs) / 60_000
    ];
    for (const g of gapsMin) {
      expect(g).toBeGreaterThan(43);
      expect(g).toBeLessThan(47);
    }
  });

  it("finish-early packing stacks goal blocks at the start of the free window with slack at the end", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const tuesdayStart = weekStartMs + DAY_MS;
    const busy: BusyEvent[] = [
      {
        id: "b1",
        startMs: tuesdayStart,
        endMs: tuesdayStart + 12 * HOUR_MS,
        busy: true
      },
      {
        id: "b2",
        startMs: tuesdayStart + 18 * HOUR_MS,
        endMs: tuesdayStart + DAY_MS,
        busy: true
      }
    ];
    const result = allocateWeek({
      plan: {
        id: "fe-buffers",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          {
            id: "a",
            title: "A",
            daysOfWeek: ["tuesday"],
            maxMinutesPerWeek: 60,
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          },
          {
            id: "b",
            title: "B",
            daysOfWeek: ["tuesday"],
            maxMinutesPerWeek: 60,
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          },
          {
            id: "c",
            title: "C",
            daysOfWeek: ["tuesday"],
            maxMinutesPerWeek: 60,
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          }
        ]
      },
      busy,
      settings: buildSettings({
        allocator: { starvationMode: "proportional", allocationMode: "finish-early" }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });

    const tuesdayEnd = tuesdayStart + DAY_MS;
    const tuesdayBlocks = result.blocks
      .filter((b) => !b.segment && b.startMs >= tuesdayStart && b.endMs <= tuesdayEnd)
      .sort((a, b) => a.startMs - b.startMs);

    expect(tuesdayBlocks.length).toBe(3);
    const windowStart = tuesdayStart + 12 * HOUR_MS;
    const windowEnd = tuesdayStart + 18 * HOUR_MS;
    const padStartMin = (tuesdayBlocks[0]!.startMs - windowStart) / 60_000;
    const gap01 = (tuesdayBlocks[1]!.startMs - tuesdayBlocks[0]!.endMs) / 60_000;
    const gap12 = (tuesdayBlocks[2]!.startMs - tuesdayBlocks[1]!.endMs) / 60_000;
    const tailMin = (windowEnd - tuesdayBlocks[2]!.endMs) / 60_000;
    expect(padStartMin).toBeLessThanOrEqual(15);
    expect(gap01).toBeLessThanOrEqual(15);
    expect(gap12).toBeLessThanOrEqual(15);
    expect(tailMin).toBeGreaterThan(160);
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

  it("weights free-time targets by allocationSharePercent in even mode", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const result = allocateWeek({
      plan: {
        id: "pct-even",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          goal({
            id: "a",
            title: "A",
            allocationSharePercent: 50
          }),
          goal({ id: "b", title: "B" }),
          goal({ id: "c", title: "C" })
        ]
      },
      busy: [],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const ta = result.metrics.perGoal["a"]!.targetMinutes;
    const tb = result.metrics.perGoal["b"]!.targetMinutes;
    const tc = result.metrics.perGoal["c"]!.targetMinutes;
    expect(tb).toBeGreaterThan(0);
    expect(tc).toBeGreaterThan(0);
    expect(Math.abs(tb - tc)).toBeLessThanOrEqual(30);
    expect(ta / tb).toBeGreaterThan(1.5);
    expect(ta / tb).toBeLessThan(2.5);
  });

  it("weights allocationSharePercent the same in finish-early packing mode as in even", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const plan = {
      id: "fe-pct",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goals: [
        goal({
          id: "first",
          title: "First",
          maxMinutesPerWeek: 120
        }),
        goal({
          id: "second",
          title: "Second",
          maxMinutesPerWeek: 120,
          allocationSharePercent: 99
        })
      ]
    };
    const even = allocateWeek({
      plan,
      busy: [],
      settings: buildSettings({
        allocator: { starvationMode: "proportional", allocationMode: "even" }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const finishEarly = allocateWeek({
      plan,
      busy: [],
      settings: buildSettings({
        allocator: { starvationMode: "proportional", allocationMode: "finish-early" }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    expect(finishEarly.metrics.perGoal["first"]!.targetMinutes).toBe(
      even.metrics.perGoal["first"]!.targetMinutes
    );
    expect(finishEarly.metrics.perGoal["second"]!.targetMinutes).toBe(
      even.metrics.perGoal["second"]!.targetMinutes
    );
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

  it("does not add equal-share remainder onto goals with a weekly floor by default", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const result = allocateWeek({
      plan: {
        id: "floor-no-bonus",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          {
            id: "floored",
            title: "Floored",
            minMinutesPerWeek: 240,
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          },
          {
            id: "share",
            title: "Share",
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
    expect(result.metrics.perGoal["floored"]!.targetMinutes).toBe(240);
    expect(result.metrics.perGoal["share"]!.targetMinutes).toBeGreaterThan(0);
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

  it("counts day-sheet logged goal minutes toward maxMinutesPerDay headroom", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0); // Mon
    const mondayStart = weekStartMs;
    const mondayNoon = mondayStart + 12 * HOUR_MS;
    const loggedBusy: BusyEvent = {
      sourceId: `daysheet-goal:workout:${mondayStart}:${mondayNoon}`,
      title: "Workout (logged)",
      startMs: mondayStart,
      endMs: mondayNoon,
      busy: true,
      source: "internal"
    };
    const result = allocateWeek({
      plan: {
        id: "logged-cap",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          {
            id: "workout",
            title: "Workout",
            minMinutesPerWeek: 120,
            maxMinutesPerDay: 60,
            daysOfWeek: ["monday", "tuesday"],
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          }
        ]
      },
      busy: [loggedBusy],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const mondayBlocks = result.blocks.filter(
      (b) => b.goalId === "workout" && b.startMs >= mondayStart && b.startMs < mondayStart + DAY_MS
    );
    const tuesdayBlocks = result.blocks.filter(
      (b) =>
        b.goalId === "workout" &&
        b.startMs >= mondayStart + DAY_MS &&
        b.startMs < mondayStart + 2 * DAY_MS
    );
    expect(mondayBlocks.length).toBe(0);
    expect(tuesdayBlocks.length).toBeGreaterThan(0);
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

  it("finish-early packing mode still allows two capped goals to fill equally when time abounds", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const result = allocateWeek({
      plan: {
        id: "finish-early-cap",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          {
            id: "first",
            title: "First",
            maxMinutesPerWeek: 240,
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          },
          {
            id: "second",
            title: "Second",
            maxMinutesPerWeek: 240,
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          }
        ]
      },
      busy: [],
      settings: buildSettings({
        allocator: { starvationMode: "proportional", allocationMode: "finish-early" }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    expect(result.metrics.perGoal["first"]!.targetMinutes).toBe(240);
    expect(result.metrics.perGoal["second"]!.targetMinutes).toBe(240);
    expect(result.metrics.utilisation.availableMinutes).toBeGreaterThan(60 * 24);
  });

  it("finish-early packing mode does not change weekly targets versus even mode", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const plan = {
      id: "finish-early-unbounded",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goals: [
        { id: "a", title: "A", priority: 3, energyMode: "neutral", ppfHorizon: "unspecified" },
        { id: "b", title: "B", priority: 3, energyMode: "neutral", ppfHorizon: "unspecified" },
        {
          id: "floor",
          title: "Floor",
          minMinutesPerWeek: 120,
          priority: 3,
          energyMode: "neutral",
          ppfHorizon: "unspecified"
        }
      ]
    };
    const even = allocateWeek({
      plan,
      busy: [],
      settings: buildSettings({
        allocator: { starvationMode: "proportional", allocationMode: "even" }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const finishEarly = allocateWeek({
      plan,
      busy: [],
      settings: buildSettings({
        allocator: { starvationMode: "proportional", allocationMode: "finish-early" }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    for (const id of ["a", "b", "floor"] as const) {
      expect(finishEarly.metrics.perGoal[id]!.targetMinutes).toBe(even.metrics.perGoal[id]!.targetMinutes);
    }
  });

  it("finish-early packing mode still fair-splits scarce week time across capped goals", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    // Each day only has a 2-hour window of free time → ~14h/wk total.
    const busy: BusyEvent[] = [];
    for (let d = 0; d < 7; d++) {
      busy.push({
        id: `morning-${d}`,
        startMs: weekStartMs + d * DAY_MS,
        endMs: weekStartMs + d * DAY_MS + 9 * HOUR_MS,
        busy: true
      });
      busy.push({
        id: `afternoon-${d}`,
        startMs: weekStartMs + d * DAY_MS + 11 * HOUR_MS,
        endMs: weekStartMs + d * DAY_MS + 24 * HOUR_MS,
        busy: true
      });
    }
    const result = allocateWeek({
      plan: {
        id: "finish-early-starve",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          {
            id: "first",
            title: "First",
            maxMinutesPerWeek: 600,
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          },
          {
            id: "second",
            title: "Second",
            maxMinutesPerWeek: 600,
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          }
        ]
      },
      busy,
      settings: buildSettings({
        allocator: { starvationMode: "proportional", allocationMode: "finish-early" }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const t1 = result.metrics.perGoal["first"]!.targetMinutes;
    const t2 = result.metrics.perGoal["second"]!.targetMinutes;
    expect(t1).toBeLessThan(600);
    expect(t2).toBeLessThan(600);
    expect(Math.abs(t1 - t2)).toBeLessThanOrEqual(15);
  });

  it("respects capped goal and floor before growing unbounded goals (same in finish-early packing)", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const result = allocateWeek({
      plan: {
        id: "finish-early-floor-first",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          {
            id: "capped-first",
            title: "Capped first",
            maxMinutesPerWeek: 120,
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          },
          {
            id: "floored-second",
            title: "Floored second",
            minMinutesPerWeek: 240,
            priority: 3,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          }
        ]
      },
      busy: [],
      settings: buildSettings({
        allocator: { starvationMode: "proportional", allocationMode: "finish-early" }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    expect(result.metrics.perGoal["capped-first"]!.targetMinutes).toBe(120);
    expect(result.metrics.perGoal["floored-second"]!.targetMinutes).toBe(240);
  });

  it("gym special goal reserves quantised drive padding on each side of the workout", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    // Monday: only 10:00–11:15 is free (75 min).
    const busy: BusyEvent[] = [
      {
        sourceId: "mon-am",
        title: "Busy",
        startMs: weekStartMs,
        endMs: weekStartMs + 10 * HOUR_MS,
        busy: true,
        source: "google"
      },
      {
        sourceId: "mon-pm",
        title: "Busy2",
        startMs: weekStartMs + 11.25 * HOUR_MS,
        endMs: weekStartMs + DAY_MS,
        busy: true,
        source: "google"
      }
    ];
    const gymPlan: WeeklyPlan = {
      id: "gym-plan",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goals: [
        {
          id: "gym-goal",
          title: "Gym",
          targetMinutes: 60,
          dayOfWeek: "monday",
          energyMode: "hyperfocus",
          ppfHorizon: "unspecified",
          specialGoalType: "gym"
        }
      ]
    };
    const plainPlan: WeeklyPlan = {
      ...gymPlan,
      id: "plain-plan",
      goals: [
        {
          id: "plain-goal",
          title: "Gym",
          targetMinutes: 60,
          dayOfWeek: "monday",
          energyMode: "hyperfocus",
          ppfHorizon: "unspecified"
        }
      ]
    };
    const settings = buildSettings({
      gym: { ...DEFAULT_USER_SETTINGS.gym, driveMinutes: 10 }
    });
    // driveMinutes 10 → 15 min grid each way → inner window 75 − 30 = 45 min.
    const gymResult = allocateWeek({
      plan: gymPlan,
      busy,
      settings,
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const plainResult = allocateWeek({
      plan: plainPlan,
      busy,
      settings,
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const gymBlock = gymResult.blocks.find((b) => b.goalId === "gym-goal");
    const plainBlock = plainResult.blocks.find((b) => b.goalId === "plain-goal");
    expect(gymBlock).toBeDefined();
    expect(plainBlock).toBeDefined();
    expect(Math.floor((gymBlock!.endMs - gymBlock!.startMs) / 60_000)).toBe(45);
    expect(Math.floor((plainBlock!.endMs - plainBlock!.startMs) / 60_000)).toBe(60);
  });

  it("places gym goals before other goals so drive windows are not taken first", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const busy: BusyEvent[] = [
      {
        sourceId: "mon-am",
        title: "Busy",
        startMs: weekStartMs,
        endMs: weekStartMs + 10 * HOUR_MS,
        busy: true,
        source: "google"
      },
      {
        sourceId: "mon-pm",
        title: "Busy2",
        startMs: weekStartMs + 11.25 * HOUR_MS,
        endMs: weekStartMs + DAY_MS,
        busy: true,
        source: "google"
      }
    ];
    const plan: WeeklyPlan = {
      id: "gym-order",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goals: [
        {
          id: "filler",
          title: "Other",
          targetMinutes: 60,
          dayOfWeek: "monday",
          energyMode: "neutral",
          ppfHorizon: "unspecified"
        },
        {
          id: "gym-goal",
          title: "Gym",
          targetMinutes: 60,
          dayOfWeek: "monday",
          energyMode: "neutral",
          ppfHorizon: "unspecified",
          specialGoalType: "gym"
        }
      ]
    };
    const result = allocateWeek({
      plan,
      busy,
      settings: buildSettings({
        gym: { ...DEFAULT_USER_SETTINGS.gym, driveMinutes: 10 }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const gymBlock = result.blocks.find((b) => b.goalId === "gym-goal");
    expect(gymBlock).toBeDefined();
    expect(Math.floor((gymBlock!.endMs - gymBlock!.startMs) / 60_000)).toBe(45);
  });

  it("restricts a goal to inverted-calendar availability windows", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0); // Mon
    const result = allocateWeek({
      plan: {
        id: "availability",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          {
            id: "friend-call",
            title: "Friend call",
            minMinutesPerWeek: 120,
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          }
        ]
      },
      busy: [],
      goalAvailabilityWindows: {
        "friend-call": [
          // Tuesday 10:00-12:00 UTC only.
          {
            startMs: weekStartMs + DAY_MS + 10 * HOUR_MS,
            endMs: weekStartMs + DAY_MS + 12 * HOUR_MS
          }
        ]
      },
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });

    const blocks = result.blocks.filter((b) => b.goalId === "friend-call");
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.startMs).toBeGreaterThanOrEqual(weekStartMs + DAY_MS + 10 * HOUR_MS);
      expect(block.endMs).toBeLessThanOrEqual(weekStartMs + DAY_MS + 12 * HOUR_MS);
    }
  });

  it("excludes inverted-timemap rows from equal-share and does not allocate blocks for them", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const monEnd = weekStartMs + DAY_MS;
    const wed10 = weekStartMs + 2 * DAY_MS + 10 * HOUR_MS;
    const wed12 = weekStartMs + 2 * DAY_MS + 12 * HOUR_MS;
    const result = allocateWeek({
      plan: {
        id: "mix",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          {
            id: "work",
            title: "Work",
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          },
          {
            id: "friend-map",
            title: "Friend free",
            specialGoalType: "inverted-timemap",
            energyMode: "neutral",
            ppfHorizon: "unspecified"
          }
        ]
      },
      busy: [],
      goalAvailabilityWindows: {
        work: [{ startMs: weekStartMs, endMs: monEnd }],
        "friend-map": [{ startMs: wed10, endMs: wed12 }]
      },
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    expect(result.metrics.perGoal["work"]!.targetMinutes).toBe(7 * 24 * 60);
    expect(result.metrics.perGoal["friend-map"]!.scheduledMinutes).toBe(0);
    expect(result.blocks.filter((b) => b.goalId === "friend-map").length).toBe(0);
  });

  it("honours goal drag override placement and dragKey", () => {
    const simplePlan: WeeklyPlan = {
      id: "goal-ov-p",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goals: [goal({ id: "solo", title: "Solo", targetMinutes: 120 })],
      overrides: []
    };
    const ws = Date.UTC(2026, 3, 27, 0, 0, 0);
    const base = allocateWeek({
      plan: simplePlan,
      busy: [],
      settings: buildSettings(),
      weekStartMs: ws,
      weekEndMs: ws + 7 * DAY_MS,
      weekAnchorDate: "2026-04-27"
    });
    const first = base.blocks.find((b) => b.goalId === "solo");
    expect(first?.dragKey).toBe(buildGoalDragKey("solo", "2026-04-27", 0));
    const delta = 2 * HOUR_MS;
    const key = first!.dragKey!;
    const withOv: WeeklyPlan = {
      ...simplePlan,
      overrides: [
        {
          kind: "goal",
          key,
          startMs: first!.startMs + delta,
          endMs: first!.endMs + delta,
          source: "drag",
          setAt: 1
        }
      ]
    };
    const moved = allocateWeek({
      plan: withOv,
      busy: [],
      settings: buildSettings(),
      weekStartMs: ws,
      weekEndMs: ws + 7 * DAY_MS,
      weekAnchorDate: "2026-04-27"
    });
    const placed = moved.blocks.find((b) => b.goalId === "solo" && b.dragKey === key);
    expect(placed?.startMs).toBe(first!.startMs + delta);
    expect(placed?.pinnedFromOverride).toBe(true);
    expect(placed?.dragOverrideSaved).toBe(true);
  });

  it("ignores a goal drag override that overlaps reserved busy and schedules in free time instead", () => {
    const weekStartIso = "2026-04-27";
    const ws = Date.UTC(2026, 3, 27, 0, 0, 0);
    const reservedStart = ws + 6 * HOUR_MS;
    const reservedEnd = ws + 10 * HOUR_MS;
    const reserved: BusyEvent = {
      sourceId: "reserved",
      title: "Morning routine",
      startMs: reservedStart,
      endMs: reservedEnd,
      busy: true,
      source: "internal"
    };
    const key = buildGoalDragKey("solo", weekStartIso, 0);
    const badStart = reservedStart + 30 * 60 * 1000;
    const badEnd = badStart + 45 * 60 * 1000;
    const result = allocateWeek({
      plan: {
        id: "p",
        weekStart: weekStartIso,
        timezone: "UTC",
        goals: [goal({ id: "solo", title: "Solo", targetMinutes: 90, maxMinutesPerDay: 90 })],
        overrides: [
          { kind: "goal", key, startMs: badStart, endMs: badEnd, source: "drag", setAt: 1 }
        ]
      },
      busy: [reserved],
      settings: buildSettings(),
      weekStartMs: ws,
      weekEndMs: ws + 7 * DAY_MS,
      weekAnchorDate: weekStartIso
    });
    const solo = result.blocks.filter((b) => b.goalId === "solo");
    expect(solo.length).toBeGreaterThanOrEqual(1);
    for (const b of solo) {
      const overlapsReserved = b.startMs < reservedEnd && b.endMs > reservedStart;
      expect(overlapsReserved).toBe(false);
    }
    expect(solo.some((b) => b.pinnedFromOverride)).toBe(false);
  });

  it("honours source actual override when it overlaps calendar busy (day sheet)", () => {
    const weekStartIso = "2026-04-27";
    const ws = Date.UTC(2026, 3, 27, 0, 0, 0);
    const reservedStart = ws + 6 * HOUR_MS;
    const reservedEnd = ws + 10 * HOUR_MS;
    const reserved: BusyEvent = {
      sourceId: "reserved",
      title: "Meeting",
      startMs: reservedStart,
      endMs: reservedEnd,
      busy: true,
      source: "google"
    };
    const key = buildGoalDragKey("solo", weekStartIso, 0);
    const actualStart = reservedStart + 30 * 60 * 1000;
    const actualEnd = actualStart + 60 * 60 * 1000;
    const sources = new Map<string, "drag" | "actual">([[key, "actual"]]);
    const result = allocateWeek({
      plan: {
        id: "p",
        weekStart: weekStartIso,
        timezone: "UTC",
        goals: [goal({ id: "solo", title: "Solo", targetMinutes: 60, maxMinutesPerDay: 120 })],
        overrides: [
          { kind: "goal", key, startMs: actualStart, endMs: actualEnd, source: "actual", setAt: 1 }
        ]
      },
      busy: [reserved],
      settings: buildSettings(),
      weekStartMs: ws,
      weekEndMs: ws + 7 * DAY_MS,
      weekAnchorDate: weekStartIso,
      goalOverrideSources: sources
    });
    const pinned = result.blocks.find((b) => b.goalId === "solo" && b.dragKey === key);
    expect(pinned?.pinnedFromOverride).toBe(true);
    expect(pinned?.startMs).toBe(actualStart);
    expect(pinned?.endMs).toBe(actualEnd);
  });

  it("rejects an actual override that overlaps computed sleep (relaxed gap rules)", () => {
    const weekStartIso = "2026-04-27";
    const ws = Date.UTC(2026, 3, 27, 0, 0, 0);
    const sleepStart = ws + 22 * HOUR_MS;
    const sleepEnd = ws + DAY_MS + 6 * HOUR_MS;
    const sleep: BusyEvent = {
      sourceId: "sleep-0",
      title: "Sleep",
      startMs: sleepStart,
      endMs: sleepEnd,
      busy: true,
      source: "internal"
    };
    const key = buildGoalDragKey("solo", weekStartIso, 0);
    const actualStart = ws + 23 * HOUR_MS;
    const actualEnd = actualStart + 60 * 60 * 1000;
    const sources = new Map<string, "drag" | "actual">([[key, "actual"]]);
    const result = allocateWeek({
      plan: {
        id: "p",
        weekStart: weekStartIso,
        timezone: "UTC",
        goals: [goal({ id: "solo", title: "Solo", targetMinutes: 60, maxMinutesPerDay: 120 })],
        overrides: [
          { kind: "goal", key, startMs: actualStart, endMs: actualEnd, source: "actual", setAt: 1 }
        ]
      },
      busy: [sleep],
      settings: buildSettings(),
      weekStartMs: ws,
      weekEndMs: ws + 7 * DAY_MS,
      weekAnchorDate: weekStartIso,
      goalOverrideSources: sources,
      sleepIntervals: [{ startMs: sleepStart, endMs: sleepEnd }]
    });
    const pinned = result.blocks.find((b) => b.goalId === "solo" && b.dragKey === key);
    expect(pinned?.pinnedFromOverride).toBeFalsy();
    for (const b of result.blocks.filter((x) => x.goalId === "solo")) {
      const overlapsSleep = b.startMs < sleepEnd && b.endMs > sleepStart;
      expect(overlapsSleep).toBe(false);
    }
  });

  it("skips auto placements entirely before nowMs", () => {
    const weekStartIso = "2026-04-27";
    const ws = Date.UTC(2026, 3, 27, 0, 0, 0);
    const nowMs = ws + 2 * DAY_MS + 12 * HOUR_MS;
    const result = allocateWeek({
      plan: {
        id: "p",
        weekStart: weekStartIso,
        timezone: "UTC",
        goals: [goal({ id: "solo", title: "Solo", targetMinutes: 180, maxMinutesPerDay: 180 })]
      },
      busy: [],
      settings: buildSettings(),
      weekStartMs: ws,
      weekEndMs: ws + 7 * DAY_MS,
      weekAnchorDate: weekStartIso,
      nowMs
    });
    const auto = result.blocks.filter(
      (b) => b.goalId === "solo" && !b.segment && !b.pinnedFromOverride
    );
    for (const b of auto) {
      expect(b.endMs).toBeGreaterThan(nowMs);
    }
    const scheduledMin =
      result.blocks
        .filter((b) => b.goalId === "solo" && !b.segment)
        .reduce((a, b) => a + Math.floor((b.endMs - b.startMs) / 60_000), 0) ?? 0;
    expect(scheduledMin).toBeGreaterThan(0);
  });

  it("still pins past actual overrides when nowMs is later in the week", () => {
    const weekStartIso = "2026-04-27";
    const ws = Date.UTC(2026, 3, 27, 0, 0, 0);
    const nowMs = ws + 3 * DAY_MS + 12 * HOUR_MS;
    const key = buildGoalDragKey("solo", weekStartIso, 0);
    const actualStart = ws + 10 * HOUR_MS;
    const actualEnd = actualStart + 60 * 60 * 1000;
    const result = allocateWeek({
      plan: {
        id: "p",
        weekStart: weekStartIso,
        timezone: "UTC",
        goals: [goal({ id: "solo", title: "Solo", targetMinutes: 120, maxMinutesPerDay: 60 })],
        overrides: [
          { kind: "goal", key, startMs: actualStart, endMs: actualEnd, source: "actual", setAt: 1 }
        ]
      },
      busy: [],
      settings: buildSettings(),
      weekStartMs: ws,
      weekEndMs: ws + 7 * DAY_MS,
      weekAnchorDate: weekStartIso,
      nowMs
    });
    const pinned = result.blocks.find((b) => b.goalId === "solo" && b.dragKey === key);
    expect(pinned?.pinnedFromOverride).toBe(true);
    expect(pinned?.startMs).toBe(actualStart);
    expect(pinned?.endMs).toBe(actualEnd);
  });

  it("uses only future capacity for weekly targets when nowMs is set", () => {
    const weekStartIso = "2026-04-27";
    const ws = Date.UTC(2026, 3, 27, 0, 0, 0);
    const nowMs = ws + 4 * DAY_MS + 12 * HOUR_MS; // Friday noon
    const result = allocateWeek({
      plan: {
        id: "p",
        weekStart: weekStartIso,
        timezone: "UTC",
        goals: [goal({ id: "solo", title: "Solo", targetMinutes: 4000 })]
      },
      busy: [],
      settings: buildSettings(),
      weekStartMs: ws,
      weekEndMs: ws + 7 * DAY_MS,
      weekAnchorDate: weekStartIso,
      nowMs
    });
    expect(result.metrics.perGoal["solo"]!.targetMinutes).toBeLessThan(4000);
    expect(result.metrics.perGoal["solo"]!.targetMinutes).toBeLessThanOrEqual(60 * 60);
  });

  it("reports free capacity as future unscheduled minutes only", () => {
    const weekStartIso = "2026-04-27";
    const ws = Date.UTC(2026, 3, 27, 0, 0, 0);
    const nowMs = ws + 4 * DAY_MS + 12 * HOUR_MS; // Friday noon
    const result = allocateWeek({
      plan: {
        id: "p",
        weekStart: weekStartIso,
        timezone: "UTC",
        goals: []
      },
      busy: [],
      settings: buildSettings(),
      weekStartMs: ws,
      weekEndMs: ws + 7 * DAY_MS,
      weekAnchorDate: weekStartIso,
      nowMs
    });
    expect(result.metrics.utilisation.availableMinutes).toBe(60 * 60);
  });

  it("buildGoalDragKey scopes overrides by week anchor and slot", () => {
    expect(buildGoalDragKey("goal-id", "2026-05-04", 0)).toBe("goal:2026-05-04:0:goal-id");
    expect(buildGoalDragKey("a:b", "2026-04-27", 3)).toBe("goal:2026-04-27:3:a:b");
  });
});

describe("allocateWeek energy-aware suggestion pass", () => {
  const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);

  it("does not regress legacy plans that omit the new classification fields", () => {
    const result = allocateWeek({
      plan,
      busy: [],
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    // Friday-pinned dinner still lands on Friday; deep coding still gets minutes.
    const dinnerBlocks = result.blocks.filter((b) => b.goalId === "g3");
    for (const block of dinnerBlocks) {
      const dayIdx = Math.floor((block.startMs - weekStartMs) / DAY_MS);
      expect(dayIdx).toBe(4);
    }
    expect(result.metrics.perGoal["g1"]!.scheduledMinutes).toBeGreaterThan(0);
  });

  it("nudges needle-mover hyper-focus goals toward earlier morning windows", () => {
    // Same morning vs evening gap setup as the play test — but here the
    // hyper-focus + needle-mover combination should land in the morning gap.
    const busy: BusyEvent[] = [];
    for (let d = 0; d < 7; d++) {
      const dayStart = weekStartMs + d * DAY_MS;
      busy.push({ id: `pre-${d}`, startMs: dayStart, endMs: dayStart + 8 * HOUR_MS, busy: true });
      busy.push({ id: `mid-${d}`, startMs: dayStart + 11 * HOUR_MS, endMs: dayStart + 17 * HOUR_MS, busy: true });
      busy.push({ id: `post-${d}`, startMs: dayStart + 21 * HOUR_MS, endMs: dayStart + 24 * HOUR_MS, busy: true });
    }
    const result = allocateWeek({
      plan: {
        id: "needle",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          {
            id: "needle-mover-goal",
            title: "Needle mover",
            minMinutesPerWeek: 120,
            maxMinutesPerWeek: 120,
            maxMinutesPerDay: 60,
            frequencyPerWeek: 2,
            energyMode: "neutral",
            energyPolarity: "energise",
            attentionMode: "hyperfocus",
            workLayer: "needle-mover",
            ppfHorizon: "unspecified"
          }
        ]
      },
      busy,
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const blocks = result.blocks.filter((b) => b.goalId === "needle-mover-goal");
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const startHour = ((block.startMs - weekStartMs) % DAY_MS) / HOUR_MS;
      expect(startHour).toBeLessThan(11);
    }
  });

  it("biases play-layer goals toward late-day windows when multiple gaps exist", () => {
    // Each day has two discrete free gaps: a morning slot (8-11) and an
    // evening slot (17-21). Play workLayer should prefer the evening slot
    // even though the existing 'neutral' energyMode would otherwise lean
    // toward the morning gap (closer to its noon target).
    const busy: BusyEvent[] = [];
    for (let d = 0; d < 7; d++) {
      const dayStart = weekStartMs + d * DAY_MS;
      busy.push({ id: `pre-${d}`, startMs: dayStart, endMs: dayStart + 8 * HOUR_MS, busy: true });
      busy.push({ id: `mid-${d}`, startMs: dayStart + 11 * HOUR_MS, endMs: dayStart + 17 * HOUR_MS, busy: true });
      busy.push({ id: `post-${d}`, startMs: dayStart + 21 * HOUR_MS, endMs: dayStart + 24 * HOUR_MS, busy: true });
    }
    const result = allocateWeek({
      plan: {
        id: "play",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          {
            id: "play-goal",
            title: "Play",
            minMinutesPerWeek: 60,
            maxMinutesPerWeek: 60,
            maxMinutesPerDay: 60,
            frequencyPerWeek: 1,
            energyMode: "neutral",
            energyPolarity: "energise",
            attentionMode: "unspecified",
            workLayer: "play",
            ppfHorizon: "unspecified"
          }
        ]
      },
      busy,
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const blocks = result.blocks.filter((b) => b.goalId === "play-goal");
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const startHour = ((block.startMs - weekStartMs) % DAY_MS) / HOUR_MS;
      expect(startHour).toBeGreaterThanOrEqual(17);
    }
  });

  it("biases placement toward the top-ranked signal when energyMode and workLayer disagree", () => {
    // Each day has the same morning vs evening gap shape. With the default
    // ranking (energyMode first), a hyperfocus + play combination should
    // still land in the morning slot. Promoting workLayer above energyMode
    // flips the tie-break toward the play-friendly evening slot.
    const busy: BusyEvent[] = [];
    for (let d = 0; d < 7; d++) {
      const dayStart = weekStartMs + d * DAY_MS;
      busy.push({ id: `pre-${d}`, startMs: dayStart, endMs: dayStart + 8 * HOUR_MS, busy: true });
      busy.push({
        id: `mid-${d}`,
        startMs: dayStart + 11 * HOUR_MS,
        endMs: dayStart + 17 * HOUR_MS,
        busy: true
      });
      busy.push({ id: `post-${d}`, startMs: dayStart + 21 * HOUR_MS, endMs: dayStart + 24 * HOUR_MS, busy: true });
    }
    const goal = {
      id: "mixed",
      title: "Mixed signals",
      minMinutesPerWeek: 60,
      maxMinutesPerWeek: 60,
      maxMinutesPerDay: 60,
      frequencyPerWeek: 1,
      energyMode: "hyperfocus",
      energyPolarity: "neutral",
      attentionMode: "unspecified",
      workLayer: "play",
      ppfHorizon: "unspecified"
    } as const;
    const planForGoal = {
      id: "mixed-plan",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goals: [goal]
    };

    const defaultRank = allocateWeek({
      plan: planForGoal,
      busy,
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const defaultBlocks = defaultRank.blocks.filter((b) => b.goalId === "mixed");
    expect(defaultBlocks.length).toBeGreaterThan(0);
    for (const block of defaultBlocks) {
      const startHour = ((block.startMs - weekStartMs) % DAY_MS) / HOUR_MS;
      expect(startHour).toBeLessThan(11);
    }

    const layerFirst = allocateWeek({
      plan: planForGoal,
      busy,
      settings: buildSettings({
        placementPriority: {
          order: ["workLayer", "energyMode", "attentionMode", "energyPolarity"]
        }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const layerBlocks = layerFirst.blocks.filter((b) => b.goalId === "mixed");
    expect(layerBlocks.length).toBeGreaterThan(0);
    for (const block of layerBlocks) {
      const startHour = ((block.startMs - weekStartMs) % DAY_MS) / HOUR_MS;
      expect(startHour).toBeGreaterThanOrEqual(17);
    }
  });

  it("schedules non-negotiable goals before nice-to-have ones when free time is scarce", () => {
    // Each day has a one-hour free window from 9-10am. Both goals want a
    // 60-minute floor, so only one can fully land. With strict starvation
    // the commitment tier sort decides who wins — the non-negotiable goal
    // listed second should beat the nice-to-have goal listed first.
    const busy: BusyEvent[] = [];
    for (let d = 0; d < 7; d++) {
      const dayStart = weekStartMs + d * DAY_MS;
      // Two sub-24h busy events bracketing a 9-10am gap.
      busy.push({
        id: `am-${d}`,
        startMs: dayStart,
        endMs: dayStart + 9 * HOUR_MS,
        busy: true
      });
      busy.push({
        id: `pm-${d}`,
        startMs: dayStart + 10 * HOUR_MS,
        endMs: dayStart + 24 * HOUR_MS,
        busy: true
      });
    }

    const result = allocateWeek({
      plan: {
        id: "tier",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          {
            id: "nice",
            title: "Nice to have",
            minMinutesPerWeek: 60,
            maxMinutesPerWeek: 60,
            maxMinutesPerDay: 60,
            frequencyPerWeek: 1,
            energyMode: "neutral",
            energyPolarity: "neutral",
            attentionMode: "unspecified",
            workLayer: "unspecified",
            ppfHorizon: "unspecified",
            commitmentLevel: "nice_to_have"
          },
          {
            id: "must",
            title: "Must do",
            minMinutesPerWeek: 60,
            maxMinutesPerWeek: 60,
            maxMinutesPerDay: 60,
            frequencyPerWeek: 1,
            energyMode: "neutral",
            energyPolarity: "neutral",
            attentionMode: "unspecified",
            workLayer: "unspecified",
            ppfHorizon: "unspecified",
            commitmentLevel: "non_negotiable"
          }
        ]
      },
      busy,
      settings: buildSettings(),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });

    // The non-negotiable goal lands first, so its block sits in the very
    // first available 9am gap (Monday) while the nice-to-have falls to a
    // later day.
    const mustBlocks = result.blocks.filter((b) => b.goalId === "must");
    const niceBlocks = result.blocks.filter((b) => b.goalId === "nice");
    expect(mustBlocks.length).toBeGreaterThan(0);
    expect(niceBlocks.length).toBeGreaterThan(0);
    const earliestMust = Math.min(...mustBlocks.map((b) => b.startMs));
    const earliestNice = Math.min(...niceBlocks.map((b) => b.startMs));
    expect(earliestMust).toBeLessThan(earliestNice);
  });

  it("ignores suggestion biases when energy ordering mode is 'ignore'", () => {
    const result = allocateWeek({
      plan: {
        id: "ignore-mode",
        weekStart: "2026-04-27",
        timezone: "UTC",
        goals: [
          {
            id: "needle",
            title: "Needle",
            minMinutesPerWeek: 60,
            frequencyPerWeek: 1,
            energyMode: "neutral",
            energyPolarity: "neutral",
            attentionMode: "hyperfocus",
            workLayer: "needle-mover",
            ppfHorizon: "unspecified"
          }
        ]
      },
      busy: [],
      settings: buildSettings({
        energyOrdering: { mode: "ignore", preferredSequence: ["hyperfocus", "neutral", "hyperaware"] }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    // With ignore-mode, the allocator picks the earliest available gap
    // (00:00 UTC on the first allowed day) regardless of the new fields.
    const blocks = result.blocks.filter((b) => b.goalId === "needle");
    expect(blocks.length).toBeGreaterThan(0);
    const earliest = Math.min(...blocks.map((b) => b.startMs));
    expect(earliest).toBe(weekStartMs);
  });

  it("skips PPF mix gap detection when schedulerFrameworkInclusion.ppfPillar is false", () => {
    const ws = DEFAULT_USER_SETTINGS.schedulerFrameworkInclusion;
    const result = allocateWeek({
      plan,
      busy: [],
      settings: buildSettings({
        schedulerFrameworkInclusion: { ...ws, ppfPillar: false },
        ppf: {
          enabled: true,
          targets: [
            { pillar: "professional", minPercent: 95, minTouchesPerWeek: 0 },
            { pillar: "personal", minPercent: 0, minTouchesPerWeek: 0 },
            { pillar: "financial", minPercent: 0, minTouchesPerWeek: 0 }
          ]
        }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    expect(result.metrics.ppfGaps.length).toBe(0);
  });

  it("prioritizes list index over commitment tier when schedulerFrameworkInclusion.commitment is false", () => {
    const tierPlan: WeeklyPlan = {
      id: "commit-off",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goals: [
        {
          id: "nice_first",
          title: "Nice listed first",
          minMinutesPerWeek: 180,
          energyMode: "neutral",
          ppfHorizon: "unspecified",
          commitmentLevel: "nice_to_have"
        },
        {
          id: "must_second",
          title: "Must listed second",
          minMinutesPerWeek: 180,
          energyMode: "neutral",
          ppfHorizon: "unspecified",
          commitmentLevel: "non_negotiable"
        }
      ]
    };
    const result = allocateWeek({
      plan: tierPlan,
      busy: [],
      settings: buildSettings({
        schedulerFrameworkInclusion: {
          ...DEFAULT_USER_SETTINGS.schedulerFrameworkInclusion,
          commitment: false
        }
      }),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS
    });
    const niceEarliest = Math.min(...result.blocks.filter((b) => b.goalId === "nice_first").map((b) => b.startMs));
    const mustEarliest = Math.min(...result.blocks.filter((b) => b.goalId === "must_second").map((b) => b.startMs));
    /** Without commitment tiers, nicer goal (list index 0) should allocate before non-negotiable at index 1. */
    expect(niceEarliest).toBeLessThan(mustEarliest);
  });
});

describe("computeAllocationRemainderFractions", () => {
  it("splits between explicit percent goals and equal-share goals", () => {
    const f = computeAllocationRemainderFractions([
      goal({ id: "a", title: "A", allocationSharePercent: 50 }),
      goal({ id: "b", title: "B" }),
      goal({ id: "c", title: "C" })
    ]);
    expect(f[0]).toBeCloseTo(0.5, 5);
    expect(f[1]).toBeCloseTo(0.25, 5);
    expect(f[2]).toBeCloseTo(0.25, 5);
  });

  it("normalizes when explicit percents sum above 100", () => {
    const f = computeAllocationRemainderFractions([
      goal({ id: "a", title: "A", allocationSharePercent: 60 }),
      goal({ id: "b", title: "B", allocationSharePercent: 50 })
    ]);
    expect(f[0]).toBeCloseTo(60 / 110, 5);
    expect(f[1]).toBeCloseTo(50 / 110, 5);
  });

  it("scales up when only percent goals sum below 100", () => {
    const f = computeAllocationRemainderFractions([
      goal({ id: "a", title: "A", allocationSharePercent: 30 }),
      goal({ id: "b", title: "B", allocationSharePercent: 30 }),
      goal({ id: "c", title: "C", allocationSharePercent: 30 })
    ]);
    expect(f[0]).toBeCloseTo(1 / 3, 5);
    expect(f[1]).toBeCloseTo(1 / 3, 5);
    expect(f[2]).toBeCloseTo(1 / 3, 5);
  });

  it("distributes evenly when no goal sets allocationSharePercent", () => {
    const f = computeAllocationRemainderFractions([
      goal({ id: "a", title: "A" }),
      goal({ id: "b", title: "B" })
    ]);
    expect(f[0]).toBeCloseTo(0.5, 5);
    expect(f[1]).toBeCloseTo(0.5, 5);
  });
});
