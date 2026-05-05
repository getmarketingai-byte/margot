import { describe, expect, it } from "vitest";
import { allocateWeek, buildGoalDragKey } from "../src/weekly";
import { computeStackedFeasibleWindowsForWeek } from "../src/goal-feasible-windows";
import type { WeeklyGoal, WeeklyPlan, UserSettings } from "@calendar-automations/schema";
import {
  DEFAULT_USER_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  weeklyGoalSchema
} from "@calendar-automations/schema";
import type { BusyEvent } from "../src/types";
import { collectBusyIntervals, freeGaps, mergeIntervals } from "../src/intervals";

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

function totalMs(intervals: readonly { startMs: number; endMs: number }[]): number {
  return intervals.reduce((a, iv) => a + Math.max(0, iv.endMs - iv.startMs), 0);
}

describe("stacked feasible windows", () => {
  it("allocateWeek stacked mode skips auto blocks but returns stackedFeasibleByGoalId", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const weekEndMs = weekStartMs + 7 * DAY_MS;
    const soloPlan: WeeklyPlan = {
      id: "plan-stack",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goalGroups: [],
      goals: [
        goal({
          id: "solo",
          title: "Solo",
          minMinutesPerWeek: 120,
          priority: 5
        })
      ],
      overrides: [],
      weeklyIntent: { hp6Focus: [] }
    };

    const result = allocateWeek({
      plan: soloPlan,
      busy: [],
      settings: buildSettings({
        allocator: { ...DEFAULT_USER_SETTINGS.allocator, goalWindowMode: "stacked" }
      }),
      weekStartMs,
      weekEndMs,
      weekAnchorDate: "2026-04-27"
    });

    expect(result.stackedFeasibleByGoalId).toBeDefined();
    expect(totalMs(result.stackedFeasibleByGoalId!.solo ?? [])).toBe(7 * DAY_MS);

    const goalBlocks = result.blocks.filter((b) => !b.segment && b.goalId === "solo");
    expect(goalBlocks).toHaveLength(0);
    expect(result.metrics.perGoal["solo"]!.unplacedMinutes).toBeGreaterThan(0);
  });

  it("stacked mode ignores WeeklyPlan goal overrides; linear mode still applies them", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const weekEndMs = weekStartMs + 7 * DAY_MS;
    const anchor = "2026-04-27";
    const dragKey = buildGoalDragKey("solo", anchor, 0);
    const soloPlan: WeeklyPlan = {
      id: "plan-stack-ov",
      weekStart: anchor,
      timezone: "UTC",
      goalGroups: [],
      goals: [
        goal({
          id: "solo",
          title: "Solo",
          minMinutesPerWeek: 120,
          priority: 5
        })
      ],
      overrides: [
        {
          kind: "goal",
          key: dragKey,
          startMs: weekStartMs + 10 * HOUR_MS,
          endMs: weekStartMs + 11 * HOUR_MS,
          source: "drag",
          setAt: 1
        }
      ],
      weeklyIntent: { hp6Focus: [] }
    };

    const stacked = allocateWeek({
      plan: soloPlan,
      busy: [],
      settings: buildSettings({
        allocator: { ...DEFAULT_USER_SETTINGS.allocator, goalWindowMode: "stacked" }
      }),
      weekStartMs,
      weekEndMs,
      weekAnchorDate: anchor
    });
    expect(stacked.blocks.filter((b) => !b.segment && b.goalId === "solo")).toHaveLength(0);

    const linear = allocateWeek({
      plan: soloPlan,
      busy: [],
      settings: buildSettings({
        allocator: { ...DEFAULT_USER_SETTINGS.allocator, goalWindowMode: "linear" }
      }),
      weekStartMs,
      weekEndMs,
      weekAnchorDate: anchor
    });
    expect(linear.blocks.some((b) => !b.segment && b.goalId === "solo")).toBe(true);
  });

  it("two unconstrained goals each receive the full-week feasible union (no cross-goal shrink)", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const weekEndMs = weekStartMs + 7 * DAY_MS;
    const duoPlan: WeeklyPlan = {
      id: "plan-two",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goalGroups: [],
      goals: [
        goal({ id: "ga", title: "A", minMinutesPerWeek: 60 }),
        goal({ id: "gb", title: "B", minMinutesPerWeek: 60 })
      ],
      overrides: [],
      weeklyIntent: { hp6Focus: [] }
    };

    const result = allocateWeek({
      plan: duoPlan,
      busy: [],
      settings: buildSettings({
        allocator: { ...DEFAULT_USER_SETTINGS.allocator, goalWindowMode: "stacked" }
      }),
      weekStartMs,
      weekEndMs,
      weekAnchorDate: "2026-04-27"
    });

    const ta = totalMs(result.stackedFeasibleByGoalId!.ga ?? []);
    const tb = totalMs(result.stackedFeasibleByGoalId!.gb ?? []);
    expect(ta).toBe(7 * DAY_MS);
    expect(tb).toBe(7 * DAY_MS);
  });

  it("scheduleInNiceWeather intersects stacked envelope with nice-weather windows", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const weekEndMs = weekStartMs + 7 * DAY_MS;
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
      id: "plan-nw-stack",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goalGroups: [],
      goals: [outdoor],
      overrides: [],
      weeklyIntent: { hp6Focus: [] }
    };

    const result = allocateWeek({
      plan: soloPlan,
      busy: [],
      niceWeatherWindows,
      settings: buildSettings({
        allocator: { ...DEFAULT_USER_SETTINGS.allocator, goalWindowMode: "stacked" }
      }),
      weekStartMs,
      weekEndMs,
      weekAnchorDate: "2026-04-27"
    });

    const env = result.stackedFeasibleByGoalId!["out-walk"]!;
    expect(env.length).toBeGreaterThan(0);
    for (const iv of env) {
      expect(iv.startMs).toBeGreaterThanOrEqual(monday9);
      expect(iv.endMs).toBeLessThanOrEqual(monday11);
    }
    expect(totalMs(env)).toBe(monday11 - monday9);
  });

  it("hard ideal after+before clips stacked envelope to that band", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const weekEndMs = weekStartMs + 7 * DAY_MS;

    const planStack: WeeklyPlan = {
      id: "ideal-stack",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goalGroups: [],
      goals: [
        goal({
          id: "banded",
          title: "Banded",
          targetMinutes: 60,
          dayOfWeek: "monday",
          placementIdealClockAfter: { hour: 10, minute: 0 },
          placementIdealClockBefore: { hour: 14, minute: 0 },
          priority: 5
        })
      ],
      overrides: [],
      weeklyIntent: { hp6Focus: [] }
    };

    const result = allocateWeek({
      plan: planStack,
      busy: [],
      settings: buildSettings({
        allocator: { ...DEFAULT_USER_SETTINGS.allocator, goalWindowMode: "stacked" }
      }),
      weekStartMs,
      weekEndMs,
      weekAnchorDate: "2026-04-27"
    });

    const winStart = weekStartMs + 10 * HOUR_MS;
    const winEnd = weekStartMs + 14 * HOUR_MS;
    const env = result.stackedFeasibleByGoalId!["banded"]!;
    expect(env.length).toBe(1);
    expect(env[0]!.startMs).toBe(winStart);
    expect(env[0]!.endMs).toBe(winEnd);
  });

  it("placementIdealClockBefore-only clips stacked envelope to midnight–before on that day", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const weekEndMs = weekStartMs + 7 * DAY_MS;

    const planStack: WeeklyPlan = {
      id: "ideal-before-only",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goalGroups: [],
      goals: [
        goal({
          id: "morning-cap",
          title: "Morning cap",
          targetMinutes: 60,
          dayOfWeek: "monday",
          placementIdealClockBefore: { hour: 14, minute: 0 },
          priority: 5
        })
      ],
      overrides: [],
      weeklyIntent: { hp6Focus: [] }
    };

    const result = allocateWeek({
      plan: planStack,
      busy: [],
      settings: buildSettings({
        allocator: { ...DEFAULT_USER_SETTINGS.allocator, goalWindowMode: "stacked" }
      }),
      weekStartMs,
      weekEndMs,
      weekAnchorDate: "2026-04-27"
    });

    const env = result.stackedFeasibleByGoalId!["morning-cap"]!;
    expect(env.length).toBe(1);
    expect(env[0]!.startMs).toBe(weekStartMs);
    expect(env[0]!.endMs).toBe(weekStartMs + 14 * HOUR_MS);
  });

  it("placementIdealClockAfter-only clips stacked envelope from after through end of day", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const weekEndMs = weekStartMs + 7 * DAY_MS;
    const tuesdayStart = weekStartMs + DAY_MS;

    const planStack: WeeklyPlan = {
      id: "ideal-after-only",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goalGroups: [],
      goals: [
        goal({
          id: "evening",
          title: "Evening",
          targetMinutes: 60,
          dayOfWeek: "tuesday",
          placementIdealClockAfter: { hour: 18, minute: 0 },
          priority: 5
        })
      ],
      overrides: [],
      weeklyIntent: { hp6Focus: [] }
    };

    const result = allocateWeek({
      plan: planStack,
      busy: [],
      settings: buildSettings({
        allocator: { ...DEFAULT_USER_SETTINGS.allocator, goalWindowMode: "stacked" }
      }),
      weekStartMs,
      weekEndMs,
      weekAnchorDate: "2026-04-27"
    });

    const env = result.stackedFeasibleByGoalId!["evening"]!;
    expect(env.length).toBe(1);
    expect(env[0]!.startMs).toBe(tuesdayStart + 18 * HOUR_MS);
    expect(env[0]!.endMs).toBe(tuesdayStart + DAY_MS);
  });

  it("computeStackedFeasibleWindowsForWeek matches allocateWeek stacked output for prepared goals", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const weekEndMs = weekStartMs + 7 * DAY_MS;
    const tz = "UTC";
    const busyRaw: BusyEvent[] = [];
    const days = [];
    for (let d = 0; d < 7; d++) {
      const dayStart = weekStartMs + d * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      const merged = mergeIntervals(collectBusyIntervals(busyRaw, dayStart, dayEnd));
      days.push({
        startMs: dayStart,
        endMs: dayEnd,
        gaps: freeGaps(dayStart, dayEnd, merged)
      });
    }
    const g = goal({ id: "x", title: "X", minMinutesPerWeek: 30 });

    const direct = computeStackedFeasibleWindowsForWeek({
      goals: [g],
      days,
      tz,
      weekStartMs,
      weekEndMs
    });

    const viaAllocator = allocateWeek({
      plan: {
        id: "cmp",
        weekStart: "2026-04-27",
        timezone: tz,
        goalGroups: [],
        goals: [g],
        overrides: [],
        weeklyIntent: { hp6Focus: [] }
      },
      busy: [],
      settings: buildSettings({
        allocator: { ...DEFAULT_USER_SETTINGS.allocator, goalWindowMode: "stacked" }
      }),
      weekStartMs,
      weekEndMs,
      weekAnchorDate: "2026-04-27"
    });

    expect(direct.x).toEqual(viaAllocator.stackedFeasibleByGoalId!.x);
  });
});

describe("hybrid goal window mode", () => {
  const hybridAllocator = buildSettings({
    allocator: { ...DEFAULT_USER_SETTINGS.allocator, goalWindowMode: "hybrid" }
  });

  it("hybrid with omitted goalWindowPlacement defaults every goal to stacked-role (Skedpal-first)", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const weekEndMs = weekStartMs + 7 * DAY_MS;
    const anchor = "2026-04-27";
    const soloPlan: WeeklyPlan = {
      id: "plan-hybrid-default",
      weekStart: anchor,
      timezone: "UTC",
      goalGroups: [],
      goals: [
        goal({
          id: "solo",
          title: "Solo",
          minMinutesPerWeek: 120,
          priority: 5
        })
      ],
      overrides: [],
      weeklyIntent: { hp6Focus: [] }
    };

    const result = allocateWeek({
      plan: soloPlan,
      busy: [],
      settings: hybridAllocator,
      weekStartMs,
      weekEndMs,
      weekAnchorDate: anchor
    });

    expect(result.stackedFeasibleByGoalId).toBeDefined();
    expect(totalMs(result.stackedFeasibleByGoalId!.solo ?? [])).toBe(7 * DAY_MS);
    expect(result.blocks.filter((b) => !b.segment && b.goalId === "solo")).toHaveLength(0);
    expect(result.metrics.perGoal["solo"]!.unplacedMinutes).toBeGreaterThan(0);
  });

  it("hybrid stacked non_blocking ribbon matches global stacked ribbon for same goal (pre–linear-cohort gaps)", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const weekEndMs = weekStartMs + 7 * DAY_MS;
    const anchor = "2026-04-27";

    const stackedPeer = goal({
      id: "stacked-peer",
      title: "Stacked",
      minMinutesPerWeek: 60
    });

    const hybridPlan: WeeklyPlan = {
      id: "plan-hybrid-pair",
      weekStart: anchor,
      timezone: "UTC",
      goalGroups: [],
      goals: [
        goal({
          id: "linear-peer",
          title: "Linear",
          goalWindowPlacement: "linear",
          minMinutesPerWeek: 180,
          priority: 5
        }),
        stackedPeer
      ],
      overrides: [],
      weeklyIntent: { hp6Focus: [] }
    };

    const hybridResult = allocateWeek({
      plan: hybridPlan,
      busy: [],
      settings: hybridAllocator,
      weekStartMs,
      weekEndMs,
      weekAnchorDate: anchor
    });

    const stackedSolo = allocateWeek({
      plan: {
        id: "plan-stacked-solo",
        weekStart: anchor,
        timezone: "UTC",
        goalGroups: [],
        goals: [stackedPeer],
        overrides: [],
        weeklyIntent: { hp6Focus: [] }
      },
      busy: [],
      settings: buildSettings({
        allocator: { ...DEFAULT_USER_SETTINGS.allocator, goalWindowMode: "stacked" }
      }),
      weekStartMs,
      weekEndMs,
      weekAnchorDate: anchor
    });

    expect(hybridResult.stackedFeasibleByGoalId!["stacked-peer"]).toEqual(
      stackedSolo.stackedFeasibleByGoalId!["stacked-peer"]
    );
    expect(hybridResult.blocks.some((b) => !b.segment && b.goalId === "linear-peer")).toBe(true);
  });

  it("hybrid blocking stacked ribbon is not wider than non_blocking after linear cohort consumes gaps", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const weekEndMs = weekStartMs + 7 * DAY_MS;
    const anchor = "2026-04-27";

    const hybridPlan: WeeklyPlan = {
      id: "plan-hybrid-ribbons",
      weekStart: anchor,
      timezone: "UTC",
      goalGroups: [],
      goals: [
        goal({
          id: "linear-peer",
          title: "Linear",
          goalWindowPlacement: "linear",
          minMinutesPerWeek: 9 * 60,
          priority: 5
        }),
        goal({
          id: "non-blocker",
          title: "NB",
          stackedRibbonVsLinearPeers: "non_blocking",
          minMinutesPerWeek: 30
        }),
        goal({
          id: "blocker",
          title: "BL",
          stackedRibbonVsLinearPeers: "blocking",
          minMinutesPerWeek: 30
        })
      ],
      overrides: [],
      weeklyIntent: { hp6Focus: [] }
    };

    const result = allocateWeek({
      plan: hybridPlan,
      busy: [],
      settings: hybridAllocator,
      weekStartMs,
      weekEndMs,
      weekAnchorDate: anchor
    });

    const tNb = totalMs(result.stackedFeasibleByGoalId!["non-blocker"] ?? []);
    const tBl = totalMs(result.stackedFeasibleByGoalId!["blocker"] ?? []);
    expect(tNb).toBe(7 * DAY_MS);
    expect(tBl).toBeLessThan(tNb);
    const placedLinearMin = result.blocks
      .filter((b) => !b.segment && b.goalId === "linear-peer")
      .reduce((a, b) => a + (b.endMs - b.startMs), 0);
    expect(placedLinearMin).toBeGreaterThan(0);
  });

  it('global stacked ignores stackedRibbonVsLinearPeers "blocking" (single pre–Pass 3 feasibility pass)', () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const weekEndMs = weekStartMs + 7 * DAY_MS;
    const anchor = "2026-04-27";

    const gBlocking = goal({
      id: "solo",
      title: "Solo",
      minMinutesPerWeek: 120,
      priority: 5,
      stackedRibbonVsLinearPeers: "blocking"
    });
    const gDefault = goal({
      id: "solo",
      title: "Solo",
      minMinutesPerWeek: 120,
      priority: 5
    });

    const stackedSettings = buildSettings({
      allocator: { ...DEFAULT_USER_SETTINGS.allocator, goalWindowMode: "stacked" }
    });

    const withFlag = allocateWeek({
      plan: {
        id: "p1",
        weekStart: anchor,
        timezone: "UTC",
        goalGroups: [],
        goals: [gBlocking],
        overrides: [],
        weeklyIntent: { hp6Focus: [] }
      },
      busy: [],
      settings: stackedSettings,
      weekStartMs,
      weekEndMs,
      weekAnchorDate: anchor
    });

    const withoutFlag = allocateWeek({
      plan: {
        id: "p2",
        weekStart: anchor,
        timezone: "UTC",
        goalGroups: [],
        goals: [gDefault],
        overrides: [],
        weeklyIntent: { hp6Focus: [] }
      },
      busy: [],
      settings: stackedSettings,
      weekStartMs,
      weekEndMs,
      weekAnchorDate: anchor
    });

    expect(withFlag.stackedFeasibleByGoalId!.solo).toEqual(withoutFlag.stackedFeasibleByGoalId!.solo);
  });
});
