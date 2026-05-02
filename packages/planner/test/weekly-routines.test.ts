import { describe, expect, it } from "vitest";
import { DEFAULT_USER_SETTINGS } from "@calendar-automations/schema";
import {
  physicalActivityWeeklyGoalFromGymSettings,
  ROUTINE_PHYSICAL_ACTIVITY_GOAL_ID
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
    expect(g.frequencyPerWeek).toBe(3);
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
    expect(g.frequencyPerWeek).toBe(2);
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
    expect(g.frequencyPerWeek).toBe(4);
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
    expect(g.frequencyPerWeek).toBe(5);
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
});
