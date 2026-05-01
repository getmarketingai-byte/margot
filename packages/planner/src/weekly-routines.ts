import {
  filterSchedulingGoals,
  type GymSettings,
  type UserSettings,
  type WeeklyErrandsRoutine,
  type WeeklyGoal
} from "@calendar-automations/schema";

/** Stable id for the settings-driven physical activity weekly block. */
export const ROUTINE_PHYSICAL_ACTIVITY_GOAL_ID = "routine:physical-activity" as const;

/** Stable id for the settings-driven errands weekly block. */
export const ROUTINE_WEEKLY_ERRANDS_GOAL_ID = "routine:weekly-errands" as const;

/**
 * Goals for allocation rollups, travel overlays, and calendar colour: drops
 * manual gym/errands rows (owned by routines settings) and appends synthetics
 * when enabled.
 */
export function schedulingGoalsWithWeeklyRoutines(
  planGoals: readonly WeeklyGoal[],
  settings: Pick<UserSettings, "gym" | "weeklyErrands">
): WeeklyGoal[] {
  const filtered = filterSchedulingGoals([...planGoals]).filter(
    (g) => g.specialGoalType !== "gym" && g.specialGoalType !== "errands"
  );
  const physical = physicalActivityWeeklyGoalFromGymSettings(settings.gym);
  const errands = weeklyErrandsGoalFromSettings(settings.weeklyErrands);
  const out: WeeklyGoal[] = [...filtered];
  if (physical) out.push(physical);
  if (errands) out.push(errands);
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

/**
 * Synthetic weekly goal when `weeklyErrands.plannerBlockEnabled` is on.
 * User-authored `specialGoalType: "errands"` plan rows are ignored.
 */
export function weeklyErrandsGoalFromSettings(w: WeeklyErrandsRoutine): WeeklyGoal | null {
  if (!w.plannerBlockEnabled) return null;
  const sessions = Math.max(1, Math.min(14, w.sessionsPerWeek));
  const block = Math.max(1, w.sessionMinutes);
  const weekly = sessions * block;
  const label = (w.blockLabel ?? "").trim() || "Errands";
  const earliestHour = Math.max(0, Math.min(23, w.earliestHour));
  const latestHour = Math.max(earliestHour + 1, Math.min(24, w.latestHour));
  const dayPin =
    w.plannerDaysOfWeek && w.plannerDaysOfWeek.length > 0
      ? { daysOfWeek: [...w.plannerDaysOfWeek] }
      : {};

  return {
    id: ROUTINE_WEEKLY_ERRANDS_GOAL_ID,
    title: label,
    minMinutesPerWeek: weekly,
    maxMinutesPerWeek: weekly,
    frequencyPerWeek: sessions,
    earliestHour,
    latestHour,
    energyMode: "hyperaware",
    energyPolarity: "neutral",
    attentionMode: "unspecified",
    workLayer: "unspecified",
    ppfHorizon: "unspecified",
    commitmentLevel: "committed",
    specialGoalType: "errands",
    anchor: "around-drive-events",
    placementIdealClockTimes: [...w.idealBlockTimes],
    ...dayPin
  };
}
