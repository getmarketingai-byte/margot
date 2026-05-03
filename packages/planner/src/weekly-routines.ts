import {
  filterSchedulingGoals,
  type GymSettings,
  type UserSettings,
  type WeeklyGoal
} from "@calendar-automations/schema";

/** Stable id for the settings-driven physical activity weekly block (legacy fallback). */
export const ROUTINE_PHYSICAL_ACTIVITY_GOAL_ID = "routine:physical-activity" as const;

/**
 * Core weekly-goal fields for a `specialGoalType: "gym"` row derived from gym settings
 * (cadence, windows, drive-oriented anchor). No `id` — used for plan-owned rows and
 * wrapped with an id for the settings synthetic.
 */
export function physicalActivityWeeklyGoalFieldsFromGym(gym: GymSettings): Omit<WeeklyGoal, "id"> {
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

  /**
   * Omit `frequencyPerWeek` unless `minMinutesPerBlock` is set. Without it,
   * `allocateGoal` does not enforce “one auto block per calendar day” for this
   * goal — multiple placements per day are allowed (still bounded by weekly
   * min/max and `maxMinutesPerDay`), so other goals can interleave more easily.
   * A min block size implies chunkier slices; pairing with max sessions/week
   * then matches the “distinct session days” spread again.
   */
  const sessionDaySpread = gym.minMinutesPerBlock !== undefined;

  return {
    title: label,
    minMinutesPerWeek: weeklyMin,
    maxMinutesPerWeek: weeklyMax,
    minMinutesPerDay: sessionMin,
    maxMinutesPerDay,
    ...(sessionDaySpread ? { frequencyPerWeek: sessionsHi } : {}),
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

/** Defaults for adding a gym row on Perfect Week from the user’s gym settings snapshot. */
export function planOwnedPhysicalActivitySkeleton(gym: GymSettings): Omit<WeeklyGoal, "id"> {
  return physicalActivityWeeklyGoalFieldsFromGym(gym);
}

/**
 * Goals for allocation rollups, travel overlays, and calendar colour: when the
 * plan already has a `specialGoalType: "gym"` row, it is kept and no synthetic
 * goal is appended. Otherwise, if `gym.plannerBlockEnabled`, the legacy synthetic
 * block is appended.
 */
export function schedulingGoalsWithWeeklyRoutines(
  planGoals: readonly WeeklyGoal[],
  settings: Pick<UserSettings, "gym">
): WeeklyGoal[] {
  const filtered = filterSchedulingGoals([...planGoals]);
  const gymFromPlan = filtered.filter((g) => g.specialGoalType === "gym");
  const nonGym = filtered.filter((g) => g.specialGoalType !== "gym");
  const synthetic = physicalActivityWeeklyGoalFromGymSettings(settings.gym);
  const injected = gymFromPlan.length > 0 ? gymFromPlan : synthetic ? [synthetic] : [];
  return [...nonGym, ...injected];
}

/**
 * Synthetic weekly goal when `gym.plannerBlockEnabled` is on and the plan has
 * no user-authored `specialGoalType: "gym"` row.
 */
export function physicalActivityWeeklyGoalFromGymSettings(gym: GymSettings): WeeklyGoal | null {
  if (!gym.plannerBlockEnabled) return null;
  return {
    id: ROUTINE_PHYSICAL_ACTIVITY_GOAL_ID,
    ...physicalActivityWeeklyGoalFieldsFromGym(gym)
  };
}
