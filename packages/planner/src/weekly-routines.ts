import {
  filterSchedulingGoals,
  type GymSettings,
  type UserSettings,
  type WeeklyGoal
} from "@calendar-automations/schema";

/** Stable id for the settings-driven physical activity weekly block. */
export const ROUTINE_PHYSICAL_ACTIVITY_GOAL_ID = "routine:physical-activity" as const;

/**
 * Goals for allocation rollups, travel overlays, and calendar colour: drops
 * manual gym rows (owned by routines settings) and appends the synthetic
 * physical-activity goal when enabled.
 */
export function schedulingGoalsWithWeeklyRoutines(
  planGoals: readonly WeeklyGoal[],
  settings: Pick<UserSettings, "gym">
): WeeklyGoal[] {
  const filtered = filterSchedulingGoals([...planGoals]).filter((g) => g.specialGoalType !== "gym");
  const physical = physicalActivityWeeklyGoalFromGymSettings(settings.gym);
  const out: WeeklyGoal[] = [...filtered];
  if (physical) out.push(physical);
  return out;
}

/**
 * Synthetic weekly goal when `gym.plannerBlockEnabled` is on.
 * User-authored `specialGoalType: "gym"` plan rows are ignored.
 */
export function physicalActivityWeeklyGoalFromGymSettings(gym: GymSettings): WeeklyGoal | null {
  if (!gym.plannerBlockEnabled) return null;
  const sessions = Math.max(1, Math.min(14, gym.sessionsPerWeek));
  const run = Math.max(1, gym.runMinutes);
  const weekly = sessions * run;
  const label = (gym.blockLabel ?? "").trim() || "Physical activity";
  const earliestHour = Math.max(0, Math.min(23, gym.earliestStart.hour));
  const latestEnd = gym.latestEnd;
  const latestHour = Math.min(
    24,
    latestEnd.minute > 0 ? latestEnd.hour + 1 : latestEnd.hour
  );
  const dayPin =
    gym.plannerDaysOfWeek && gym.plannerDaysOfWeek.length > 0
      ? { daysOfWeek: [...gym.plannerDaysOfWeek] }
      : {};

  return {
    id: ROUTINE_PHYSICAL_ACTIVITY_GOAL_ID,
    title: label,
    minMinutesPerWeek: weekly,
    maxMinutesPerWeek: weekly,
    frequencyPerWeek: sessions,
    earliestHour,
    latestHour,
    energyMode: "hyperfocus",
    energyPolarity: "neutral",
    attentionMode: "unspecified",
    workLayer: "unspecified",
    ppfHorizon: "unspecified",
    commitmentLevel: "committed",
    specialGoalType: "gym",
    anchor: "gym-preferred-window",
    placementIdealClockTimes: [...gym.idealBlockTimes],
    ...dayPin
  };
}
