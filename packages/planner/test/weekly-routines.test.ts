import { describe, expect, it } from "vitest";
import { DEFAULT_USER_SETTINGS, weeklyGoalSchema } from "@margot/schema";
import {
  goalsInPlanOrderForRibbonLanes,
  physicalActivityWeeklyGoalFromGymSettings,
  ROUTINE_PHYSICAL_ACTIVITY_GOAL_ID,
  schedulingGoalsWithWeeklyRoutines
} from "../src/weekly-routines";

describe("physicalActivityWeeklyGoalFromGymSettings", () => {
  it("returns null when planner block is off", () => {
    expect(
      physicalActivityWeeklyGoalFromGymSettings({
        ...DEFAULT_USER_SETTINGS.gym,
        plannerBlockEnabled: false
      })
    ).toBeNull();
  });

  it("uses runMinutes when session bounds are omitted", () => {
    const g = physicalActivityWeeklyGoalFromGymSettings({
      ...DEFAULT_USER_SETTINGS.gym,
      plannerBlockEnabled: true,
      sessionsPerWeek: 3,
      runMinutes: 40,
      sessionMinutesMin: undefined,
      sessionMinutesMax: undefined
    })!;
    expect(g.id).toBe(ROUTINE_PHYSICAL_ACTIVITY_GOAL_ID);
    expect(g.minMinutesPerWeek).toBe(120);
    expect(g.maxMinutesPerWeek).toBe(120);
    expect(g.minMinutesPerDay).toBe(40);
    expect(g.maxMinutesPerDay).toBe(40);
    expect(g.frequencyPerWeek).toBeUndefined();
  });

  it("derives weekly band from session min/max", () => {
    const g = physicalActivityWeeklyGoalFromGymSettings({
      ...DEFAULT_USER_SETTINGS.gym,
      plannerBlockEnabled: true,
      sessionsPerWeek: 2,
      runMinutes: 99,
      sessionMinutesMin: 35,
      sessionMinutesMax: 50
    })!;
    expect(g.minMinutesPerWeek).toBe(70);
    expect(g.maxMinutesPerWeek).toBe(100);
    expect(g.minMinutesPerDay).toBe(35);
    expect(g.maxMinutesPerDay).toBe(50);
    expect(g.frequencyPerWeek).toBeUndefined();
  });

  it("derives weekly band from cadence min/max", () => {
    const g = physicalActivityWeeklyGoalFromGymSettings({
      ...DEFAULT_USER_SETTINGS.gym,
      plannerBlockEnabled: true,
      sessionsPerWeek: 3,
      sessionsPerWeekMin: 2,
      sessionsPerWeekMax: 4,
      runMinutes: 40,
      sessionMinutesMin: 30,
      sessionMinutesMax: 40
    })!;
    expect(g.minMinutesPerWeek).toBe(60);
    expect(g.maxMinutesPerWeek).toBe(160);
    expect(g.frequencyPerWeek).toBeUndefined();
  });

  it("normalizes swapped cadence bounds", () => {
    const g = physicalActivityWeeklyGoalFromGymSettings({
      ...DEFAULT_USER_SETTINGS.gym,
      plannerBlockEnabled: true,
      sessionsPerWeek: 1,
      sessionsPerWeekMin: 5,
      sessionsPerWeekMax: 3,
      runMinutes: 30,
      sessionMinutesMin: 30,
      sessionMinutesMax: 30
    })!;
    expect(g.minMinutesPerWeek).toBe(90);
    expect(g.maxMinutesPerWeek).toBe(150);
    expect(g.frequencyPerWeek).toBeUndefined();
  });

  it("normalizes swapped session minute bounds using run fallback", () => {
    const g = physicalActivityWeeklyGoalFromGymSettings({
      ...DEFAULT_USER_SETTINGS.gym,
      plannerBlockEnabled: true,
      sessionsPerWeek: 1,
      runMinutes: 30,
      sessionMinutesMin: 48,
      sessionMinutesMax: 40
    })!;
    expect(g.minMinutesPerDay).toBe(40);
    expect(g.maxMinutesPerDay).toBe(48);
  });

  it("maps gym earliest/latest to placement ideal after/before (hard window, minute precision)", () => {
    const g = physicalActivityWeeklyGoalFromGymSettings({
      ...DEFAULT_USER_SETTINGS.gym,
      plannerBlockEnabled: true,
      earliestStart: { hour: 7, minute: 15 },
      latestEnd: { hour: 21, minute: 45 }
    })!;
    expect(g.placementIdealClockAfter).toEqual({ hour: 7, minute: 15 });
    expect(g.placementIdealClockBefore).toEqual({ hour: 21, minute: 45 });
    expect(g.earliestHour).toBeUndefined();
    expect(g.latestHour).toBeUndefined();
  });

  it("passes optional min block and max blocks per day to the synthetic goal", () => {
    const g = physicalActivityWeeklyGoalFromGymSettings({
      ...DEFAULT_USER_SETTINGS.gym,
      plannerBlockEnabled: true,
      minMinutesPerBlock: 90,
      maxAutoBlocksPerDay: 1
    })!;
    expect(g.minMinutesPerBlock).toBe(90);
    expect(g.maxAutoBlocksPerDay).toBe(1);
  });

  it("sets frequencyPerWeek only when min block size is set (session-day spread)", () => {
    const gMin = physicalActivityWeeklyGoalFromGymSettings({
      ...DEFAULT_USER_SETTINGS.gym,
      plannerBlockEnabled: true,
      sessionsPerWeek: 3,
      minMinutesPerBlock: 60
    })!;
    expect(gMin.frequencyPerWeek).toBe(3);

    const gMaxOnly = physicalActivityWeeklyGoalFromGymSettings({
      ...DEFAULT_USER_SETTINGS.gym,
      plannerBlockEnabled: true,
      sessionsPerWeek: 4,
      maxAutoBlocksPerDay: 2
    })!;
    expect(gMaxOnly.frequencyPerWeek).toBeUndefined();
  });

  it("sets frequency min/max when min block size is set and cadence is a band", () => {
    const g = physicalActivityWeeklyGoalFromGymSettings({
      ...DEFAULT_USER_SETTINGS.gym,
      plannerBlockEnabled: true,
      sessionsPerWeek: 3,
      sessionsPerWeekMin: 2,
      sessionsPerWeekMax: 5,
      minMinutesPerBlock: 60
    })!;
    expect(g.frequencyPerWeekMin).toBe(2);
    expect(g.frequencyPerWeekMax).toBe(5);
    expect(g.frequencyPerWeek).toBeUndefined();
  });
});

describe("schedulingGoalsWithWeeklyRoutines", () => {
  it("keeps a plan gym row and does not append the settings synthetic", () => {
    const planGym = {
      ...physicalActivityWeeklyGoalFromGymSettings({
        ...DEFAULT_USER_SETTINGS.gym,
        plannerBlockEnabled: true
      })!,
      id: "user-plan-gym",
      title: "Strength"
    };
    const out = schedulingGoalsWithWeeklyRoutines([planGym], {
      gym: { ...DEFAULT_USER_SETTINGS.gym, plannerBlockEnabled: true }
    });
    expect(out.some((g) => g.id === ROUTINE_PHYSICAL_ACTIVITY_GOAL_ID)).toBe(false);
    expect(out.some((g) => g.id === "user-plan-gym")).toBe(true);
  });

  it("appends the synthetic when the plan has no gym row and planner block is on", () => {
    const out = schedulingGoalsWithWeeklyRoutines([], {
      gym: { ...DEFAULT_USER_SETTINGS.gym, plannerBlockEnabled: true }
    });
    expect(out.some((g) => g.id === ROUTINE_PHYSICAL_ACTIVITY_GOAL_ID)).toBe(true);
  });
});

describe("goalsInPlanOrderForRibbonLanes", () => {
  it("keeps a plan gym row in hub list position (not forced to the end)", () => {
    const gymSynth = physicalActivityWeeklyGoalFromGymSettings({
      ...DEFAULT_USER_SETTINGS.gym,
      plannerBlockEnabled: true
    })!;
    const planGym = weeklyGoalSchema.parse({
      ...gymSynth,
      id: "user-plan-gym",
      title: "Strength"
    });
    const first = weeklyGoalSchema.parse({ id: "g1", title: "First" });
    const last = weeklyGoalSchema.parse({ id: "g2", title: "Last" });
    const plan = [first, planGym, last];
    expect(schedulingGoalsWithWeeklyRoutines(plan, DEFAULT_USER_SETTINGS).map((g) => g.id)).toEqual([
      "g1",
      "g2",
      "user-plan-gym"
    ]);
    expect(goalsInPlanOrderForRibbonLanes(plan, DEFAULT_USER_SETTINGS).map((g) => g.id)).toEqual([
      "g1",
      "user-plan-gym",
      "g2"
    ]);
  });

  it("appends synthetic physical activity after plan rows when present", () => {
    const plan = [
      weeklyGoalSchema.parse({ id: "only", title: "Only" })
    ];
    const ribbon = goalsInPlanOrderForRibbonLanes(plan, {
      gym: { ...DEFAULT_USER_SETTINGS.gym, plannerBlockEnabled: true }
    });
    expect(ribbon.map((g) => g.id)).toEqual(["only", ROUTINE_PHYSICAL_ACTIVITY_GOAL_ID]);
  });
});
