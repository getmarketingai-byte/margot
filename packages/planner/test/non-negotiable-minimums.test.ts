import { describe, expect, it } from "vitest";
import { allocateWeek } from "../src/weekly";
import type { AllocatedBlock } from "../src/weekly";
import type { BusyEvent } from "../src/types";
import type { WeeklyGoal, WeeklyPlan, UserSettings } from "@calendar-automations/schema";
import {
  DEFAULT_USER_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  weeklyGoalSchema
} from "@calendar-automations/schema";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function buildSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return { ...DEFAULT_USER_SETTINGS, schemaVersion: SETTINGS_SCHEMA_VERSION, ...overrides };
}

function nnSettings(enabled: boolean, morningHour = 7): UserSettings {
  return buildSettings({
    allocator: {
      ...DEFAULT_USER_SETTINGS.allocator,
      nonNegotiableMinimumsEnabled: enabled,
      nonNegotiableMinimumsMorningFallbackHour: morningHour
    }
  });
}

function goal(p: Partial<WeeklyGoal> & Pick<WeeklyGoal, "id" | "title">): WeeklyGoal {
  return weeklyGoalSchema.parse({
    priority: 3,
    energyMode: "neutral",
    ppfHorizon: "unspecified",
    ...p
  });
}

function scheduledMinutes(blocks: readonly AllocatedBlock[], goalId: string): number {
  let sum = 0;
  for (const b of blocks) {
    if (b.segment || b.goalId !== goalId) continue;
    sum += Math.floor((b.endMs - b.startMs) / 60_000);
  }
  return sum;
}

describe("non-negotiable minimums", () => {
  it("runs minimum-first reservations so a greedy peer cannot consume the lone pocket ahead of flagged daily mins", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);
    const pocketEnd = weekStartMs + 8 * HOUR_MS + 52 * 60 * 1000;
    /** 52‑minute isolated Monday pocket; peer greedy may grab it first when minimum-first mode is off. */
    const busy: BusyEvent[] = [
      { id: "m1", startMs: weekStartMs, endMs: weekStartMs + 8 * HOUR_MS, busy: true, title: "Morning hold" },
      { id: "m2", startMs: pocketEnd, endMs: weekStartMs + DAY_MS, busy: true, title: "Afternoon hold" }
    ];

    const nnGoal = goal({
      id: "zz-nn",
      title: "NN floor",
      daysOfWeek: ["monday"],
      minMinutesPerDay: 45,
      minMinutesPerDayNonNegotiable: true,
      minMinutesPerWeek: 45,
      targetMinutes: 45
    });
    const peerGoal = goal({
      id: "aa-peer",
      title: "Peer",
      daysOfWeek: ["monday"],
      minMinutesPerWeek: 500,
      targetMinutes: 500,
      priority: 2
    });

    const plan: WeeklyPlan = {
      id: "p-nn-pocket",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goalGroups: [],
      goals: [peerGoal, nnGoal],
      overrides: [],
      weeklyIntent: { hp6Focus: [] }
    };

    const disabled = allocateWeek({
      plan,
      busy,
      niceWeatherWindows: [],
      settings: nnSettings(false),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS,
      weekAnchorDate: "2026-04-27"
    });

    const enabled = allocateWeek({
      plan,
      busy,
      niceWeatherWindows: [],
      settings: nnSettings(true),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS,
      weekAnchorDate: "2026-04-27"
    });

    expect(scheduledMinutes(enabled.blocks, "zz-nn")).toBeGreaterThanOrEqual(45);
    expect(scheduledMinutes(enabled.blocks, "zz-nn")).toBeGreaterThan(
      scheduledMinutes(disabled.blocks, "zz-nn")
    );
    expect(enabled.metrics.perGoal["zz-nn"]!.unplacedMinutes).toBeLessThanOrEqual(
      disabled.metrics.perGoal["zz-nn"]!.unplacedMinutes
    );
  });

  it("places overlapped overlay blocks without changing weekCapacityMinutes", () => {
    const weekStartMs = Date.UTC(2026, 3, 27, 0, 0, 0);

    /** Full Monday busy + partial tail after Thursday so weekday index 6 is inside a clipped multi-day clip. */

    const busy: BusyEvent[] = [
      { id: "mon-conf", startMs: weekStartMs, endMs: weekStartMs + DAY_MS, busy: true, title: "Conference" },
      {
        id: "away",
        startMs: weekStartMs + 3 * DAY_MS + 12 * HOUR_MS,
        endMs: weekStartMs + 7 * DAY_MS,
        busy: true,
        title: "Away"
      }
    ];

    const lone = goal({
      id: "overlay-goal",
      title: "Overlay me",
      daysOfWeek: ["monday"],
      minMinutesPerDay: 45,
      minMinutesPerWeek: 45,
      targetMinutes: 45,
      earliestHour: 6,
      latestHour: 22
    });

    const plan: WeeklyPlan = {
      id: "ov-cap",
      weekStart: "2026-04-27",
      timezone: "UTC",
      goalGroups: [],
      goals: [lone],
      overrides: [],
      weeklyIntent: { hp6Focus: [] }
    };

    const off = allocateWeek({
      plan,
      busy,
      niceWeatherWindows: [],
      settings: nnSettings(false),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS,
      weekAnchorDate: "2026-04-27"
    });

    const on = allocateWeek({
      plan,
      busy,
      niceWeatherWindows: [],
      settings: nnSettings(true),
      weekStartMs,
      weekEndMs: weekStartMs + 7 * DAY_MS,
      weekAnchorDate: "2026-04-27"
    });

    expect(on.metrics.utilisation.weekCapacityMinutes).toBe(off.metrics.utilisation.weekCapacityMinutes);
    expect(on.blocks.some((b) => b.overBusy === true && b.goalId === "overlay-goal")).toBe(true);
    expect(off.blocks.every((b) => !b.overBusy)).toBe(true);
    expect(on.metrics.perGoal["overlay-goal"]!.unplacedMinutes).toBeLessThanOrEqual(
      off.metrics.perGoal["overlay-goal"]!.unplacedMinutes
    );
  });
});
