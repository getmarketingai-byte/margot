import { describe, expect, it } from "vitest";
import type { BusyEvent } from "@calendar-automations/planner";
import type { SleepSettings, TimemapSettings } from "@calendar-automations/schema";
import { computeSleepBlocks, isLoggedActualSleepTitle, sleepIntervalsForAllocation } from "./week-blocks";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Monday 2026-05-04 00:00 UTC (week anchor). */
const WEEK_START_MS = Date.UTC(2026, 4, 4, 0, 0, 0, 0);

const baseSleep: SleepSettings = {
  durationHours: 8,
  windowStartHour: 20,
  windowEndHour: 12,
  idealWakeHour: 7,
  idealWakeMinute: 0,
  bufferBeforeLeaveMinutes: 0,
  bufferAfterDriveHomeMinutes: 0,
  travelBufferRoundMinutes: 0,
  minBlockHours: 4,
  ignoreEventTitles: ["Gym"]
};

const timemapMorning60: TimemapSettings = {
  bands: [],
  minBlockMinutes: 30,
  cumulativeDeepWork: false,
  morningRoutine: { enabled: true, title: "[MorningRoutine]", minutes: 60 },
  shutdownRoutine: { enabled: false, title: "[ShutdownRoutine]", minutes: 30 },
  errands: { title: "[Errands]", windowMinutes: 60 },
  treatSkedpalAsBusy: true
};

describe("computeSleepBlocks + timemap routines", () => {
  it("detects logged actual sleep titles case-insensitively", () => {
    expect(isLoggedActualSleepTitle("[Sleep][Actual]")).toBe(true);
    expect(isLoggedActualSleepTitle("[Sleep] [Actual]")).toBe(true);
    expect(isLoggedActualSleepTitle("[sleep][actual] notes")).toBe(true);
    expect(isLoggedActualSleepTitle("[Sleep] planned")).toBe(false);
  });

  it("suppresses modeled sleep for a night when calendar has busy [Sleep][Actual]", () => {
    const mondayNightStart = WEEK_START_MS + 23 * HOUR_MS;
    const tuesdayWake = WEEK_START_MS + DAY_MS + 7 * HOUR_MS;
    const actualSleep: BusyEvent = {
      sourceId: "cal-sleep",
      title: "[Sleep][Actual]",
      startMs: mondayNightStart,
      endMs: tuesdayWake,
      busy: true,
      source: "google"
    };
    const blocks = computeSleepBlocks(
      WEEK_START_MS,
      [actualSleep],
      baseSleep,
      "UTC",
      0,
      new Map(),
      undefined
    );
    expect(blocks.filter((b) => b.override?.key === "0")).toHaveLength(0);
    const intervals = sleepIntervalsForAllocation(blocks, [actualSleep]);
    expect(intervals.some((i) => i.startMs <= mondayNightStart && i.endMs >= tuesdayWake)).toBe(
      true
    );
  });

  it("pulls sleep end earlier by morning routine before outbound drive", () => {
    const tuesday7am = WEEK_START_MS + DAY_MS + 7 * HOUR_MS;
    const tuesday8am = WEEK_START_MS + DAY_MS + 8 * HOUR_MS;
    const drivePre: BusyEvent = {
      sourceId: "cal-drive",
      title: "[Drive] → Event A",
      startMs: tuesday7am,
      endMs: tuesday8am,
      busy: true,
      source: "internal"
    };

    const without = computeSleepBlocks(
      WEEK_START_MS,
      [drivePre],
      baseSleep,
      "UTC",
      0,
      new Map(),
      undefined
    );
    const withMorning = computeSleepBlocks(
      WEEK_START_MS,
      [drivePre],
      baseSleep,
      "UTC",
      0,
      new Map(),
      timemapMorning60
    );

    const primaryWithout = without.find((b) => b.override?.key === "0");
    const primaryWith = withMorning.find((b) => b.override?.key === "0");
    expect(primaryWithout).toBeDefined();
    expect(primaryWith).toBeDefined();
    expect(primaryWith!.endMs).toBe(tuesday7am - 60 * 60 * 1000);
    expect(primaryWithout!.endMs).toBe(tuesday7am);
    expect(primaryWith!.startMs).toBeLessThan(primaryWithout!.startMs);
  });

  it("delays sleep start when shutdown must follow a late calendar event", () => {
    const monday2230 = WEEK_START_MS + 22 * HOUR_MS + 30 * 60 * 1000;
    const monday2315 = WEEK_START_MS + 23 * HOUR_MS + 15 * 60 * 1000;
    const meeting: BusyEvent = {
      sourceId: "meet-1",
      title: "Late",
      startMs: monday2230,
      endMs: monday2315,
      busy: true,
      source: "google"
    };

    const timemapShutdown45: TimemapSettings = {
      bands: [],
      minBlockMinutes: 30,
      cumulativeDeepWork: false,
      morningRoutine: { enabled: false, title: "[MorningRoutine]", minutes: 30 },
      shutdownRoutine: { enabled: true, title: "[ShutdownRoutine]", minutes: 45 },
      errands: { title: "[Errands]", windowMinutes: 60 },
      treatSkedpalAsBusy: true
    };

    const without = computeSleepBlocks(
      WEEK_START_MS,
      [meeting],
      baseSleep,
      "UTC",
      0,
      new Map(),
      undefined
    );
    const withShutdown = computeSleepBlocks(
      WEEK_START_MS,
      [meeting],
      baseSleep,
      "UTC",
      0,
      new Map(),
      timemapShutdown45
    );

    const p0 = without.find((b) => b.override?.key === "0");
    const p1 = withShutdown.find((b) => b.override?.key === "0");
    expect(p0).toBeDefined();
    expect(p1).toBeDefined();
    expect(p1!.startMs).toBeGreaterThanOrEqual(p0!.startMs);
    // Effective busy ends 23:15 + 45m = Tue 00:00; sleep cannot start before then.
    expect(p1!.startMs).toBeGreaterThanOrEqual(monday2315 + 45 * 60 * 1000);
  });

  it("ignores internal non-drive busy when placing sleep (scheduler cannot move sleep)", () => {
    const tue5am = WEEK_START_MS + DAY_MS + 5 * HOUR_MS;
    const tue6am = WEEK_START_MS + DAY_MS + 6 * HOUR_MS;
    const proposedLike: BusyEvent = {
      sourceId: "proposed-neutrino",
      title: "Neutrino Code",
      startMs: tue5am,
      endMs: tue6am,
      busy: true,
      source: "internal"
    };
    const blocks = computeSleepBlocks(
      WEEK_START_MS,
      [proposedLike],
      baseSleep,
      "UTC",
      0,
      new Map(),
      undefined
    );
    const monNight = blocks.find((b) => b.system === "sleep" && b.override?.key === "0");
    expect(monNight).toBeDefined();
    expect(monNight!.title).toBe("Sleep");
    expect(monNight!.endMs).toBe(WEEK_START_MS + DAY_MS + 7 * HOUR_MS);
  });

  it("still treats overlapping Google busy as sleep collision (external calendar)", () => {
    const tue5am = WEEK_START_MS + DAY_MS + 5 * HOUR_MS;
    const tue6am = WEEK_START_MS + DAY_MS + 6 * HOUR_MS;
    const calendarWork: BusyEvent = {
      sourceId: "cal-neutrino",
      title: "Neutrino Code",
      startMs: tue5am,
      endMs: tue6am,
      busy: true,
      source: "google"
    };
    const blocks = computeSleepBlocks(
      WEEK_START_MS,
      [calendarWork],
      baseSleep,
      "UTC",
      0,
      new Map(),
      undefined
    );
    const monNight = blocks.find((b) => b.system === "sleep" && b.override?.key === "0");
    expect(monNight).toBeDefined();
    expect(monNight!.title).not.toBe("Sleep");
    expect(monNight!.title).toContain("conflicts:");
  });

  it("includes sleep for nights whose wake is already past (full-week busy budget)", () => {
    // Monday May 4 2026 00:00 UTC week; Tue 07:00 is wake after Mon night sleep.
    const tue7am = WEEK_START_MS + DAY_MS + 7 * HOUR_MS;
    const friNoon = WEEK_START_MS + 4 * DAY_MS + 12 * HOUR_MS;
    expect(tue7am).toBeLessThan(friNoon);

    const blocks = computeSleepBlocks(WEEK_START_MS, [], baseSleep, "UTC", friNoon, new Map(), undefined);
    const monNight = blocks.find((b) => b.system === "sleep" && b.override?.key === "0");
    expect(monNight).toBeDefined();
    expect(monNight!.endMs).toBe(tue7am);
    expect(monNight!.endMs).toBeLessThan(friNoon);
  });
});
