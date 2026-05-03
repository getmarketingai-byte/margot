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
  const cadenceFb = gym.sessionsPerWeek;
  const rawCadenceMin = gym.sessionsPerWeekMin ?? cadenceFb;
  const rawCadenceMax = gym.sessionsPerWeekMax ?? cadenceFb;
  const sessionsLo = Math.max(1, Math.min(14, Math.min(rawCadenceMin, rawCadenceMax)));
  const sessionsHi = Math.max(sessionsLo, Math.min(14, Math.max(rawCadenceMin, rawCadenceMax)));
  const runFallback = Math.max(1, gym.runMinutes);
  const rawMin = gym.sessionMinutesMin ?? runFallback;
  const rawMax = gym.sessionMinutesMax ?? runFallback;
  const sessionMin = Math.max(1, Math.min(240, Math.min(rawMin, rawMax)));
  const sessionMax = Math.max(sessionMin, Math.min(240, Math.max(rawMin, rawMax)));
  const weeklyMin = sessionsLo * sessionMin;
  const weeklyMax = sessionsHi * sessionMax;
  /** One workout block per day — spill passes otherwise stack extra slices on the same day. */
  const maxMinutesPerDay = sessionMax;
  const label = (gym.blockLabel ?? "").trim() || "Physical activity";
  /** Same hard band as manual goals’ paired ideal-after / ideal-before (minute precision). */
  const placementIdealClockAfter = {
    hour: Math.max(0, Math.min(23, gym.earliestStart.hour)),
    minute: Math.max(0, Math.min(59, gym.earliestStart.minute))
  };
  const placementIdealClockBefore = {
    hour: Math.max(0, Math.min(23, gym.latestEnd.hour)),
    minute: Math.max(0, Math.min(59, gym.latestEnd.minute))
  };
  const dayPin =
    gym.plannerDaysOfWeek && gym.plannerDaysOfWeek.length > 0
      ? { daysOfWeek: [...gym.plannerDaysOfWeek] }
      : {};

  return {
    id: ROUTINE_PHYSICAL_ACTIVITY_GOAL_ID,
    title: label,
    minMinutesPerWeek: weeklyMin,
    maxMinutesPerWeek: weeklyMax,
    minMinutesPerDay: sessionMin,
    maxMinutesPerDay,
    frequencyPerWeek: sessionsHi,
    placementIdealClockAfter,
    placementIdealClockBefore,
    energyMode: "hyperfocus",
    energyPolarity: "neutral",
    attentionMode: "unspecified",
    workLayer: "unspecified",
    ppfHorizon: "unspecified",
    commitmentLevel: "committed",
    specialGoalType: "gym",
    anchor: "gym-preferred-window",
    placementIdealClockTimes: [...gym.idealBlockTimes],
    ...dayPin,
    ...(gym.minMinutesPerBlock !== undefined
      ? { minMinutesPerBlock: gym.minMinutesPerBlock }
      : {}),
    ...(gym.maxAutoBlocksPerDay !== undefined
      ? { maxAutoBlocksPerDay: gym.maxAutoBlocksPerDay }
      : {})
  };
}
