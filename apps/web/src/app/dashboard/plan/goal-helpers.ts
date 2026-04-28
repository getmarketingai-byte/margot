/**
 * Pure helpers for the Perfect Week page.
 *
 * Used by both the server component (for chip rendering during initial paint)
 * and the client component (for live updates as the user types). Anything that
 * computes UI strings or summary numbers belongs here so the rendering layer
 * stays declarative.
 */

import type {
  AttentionMode,
  EnergyMode,
  EnergyPolarity,
  PpfPillarKey,
  SpecialGoalType,
  WeeklyGoal,
  WorkLayer
} from "@calendar-automations/schema";
import { filterSchedulingGoals, normaliseGoalTime } from "@calendar-automations/schema";

export type ChipKind =
  | "min-week"
  | "max-week"
  | "min-day"
  | "max-day"
  | "frequency"
  | "day"
  | "energy"
  | "polarity"
  | "attention"
  | "layer"
  | "wheel"
  | "ppf"
  | "special";

export interface Chip {
  /** Stable identifier used as React key and for drawer focus. */
  key: ChipKind;
  /** What we render inside the chip. */
  label: string;
}

/** Shown on collapsed goal rows; energy / attention / wheel / PPF stay in expand. */
const SUMMARY_ROW_CHIP_KEYS = new Set<ChipKind>([
  "special",
  "min-week",
  "max-week",
  "min-day",
  "max-day",
  "frequency",
  "day"
]);

const ENERGY_LABELS: Record<EnergyMode, string> = {
  hyperfocus: "Deep focus",
  neutral: "Neutral",
  hyperaware: "Scanning"
};

export const ENERGY_POLARITY_LABELS: Record<EnergyPolarity, string> = {
  energise: "Energises",
  drain: "Drains",
  neutral: "Neutral energy"
};

export const ATTENTION_MODE_LABELS: Record<AttentionMode, string> = {
  hyperfocus: "Hyper focus",
  hyperaware: "Hyper awareness",
  unspecified: "Attention: any"
};

export const WORK_LAYER_LABELS: Record<WorkLayer, string> = {
  "needle-mover": "Needle mover",
  execution: "Execution",
  ops: "Ops / future",
  play: "Play",
  unspecified: "Layer: any"
};

const DAY_LABELS: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun"
};

const PPF_LABELS: Record<PpfPillarKey, string> = {
  personal: "Personal",
  professional: "Professional",
  financial: "Financial"
};

const SPECIAL_GOAL_LABELS: Record<SpecialGoalType, string> = {
  "morning-routine": "Morning routine",
  "shutdown-routine": "Shutdown routine",
  gym: "Gym",
  errands: "Errands",
  "inverted-timemap": "Calendar time map"
};

/**
 * Translate a minute count into a friendly "5h", "30m", "1h 30m" string.
 */
export function formatMinutes(min: number): string {
  if (min <= 0) return "0";
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  const rem = min % 60;
  if (rem === 0) return `${hours}h`;
  return `${hours}h ${rem}m`;
}

/**
 * Translate a goal into the chips shown next to its title in the list/input.
 *
 * The chip set mirrors the Behaviour Matrix in the plan: blank means equal
 * share, time-bounded fields show as floor/ceiling chips, cadence and tag
 * fields show as suffix-style chips.
 */
export function chipsForGoal(goal: WeeklyGoal, wheelLabel?: (id: string) => string): Chip[] {
  const chips: Chip[] = [];
  if (goal.specialGoalType) {
    chips.push({
      key: "special",
      label: SPECIAL_GOAL_LABELS[goal.specialGoalType] ?? goal.specialGoalType
    });
  }
  if (goal.minMinutesPerWeek !== undefined) {
    chips.push({ key: "min-week", label: `≥ ${formatMinutes(goal.minMinutesPerWeek)}/wk` });
  }
  if (goal.minMinutesPerDay !== undefined) {
    chips.push({ key: "min-day", label: `≥ ${formatMinutes(goal.minMinutesPerDay)}/day` });
  }
  if (goal.maxMinutesPerWeek !== undefined) {
    chips.push({ key: "max-week", label: `≤ ${formatMinutes(goal.maxMinutesPerWeek)}/wk` });
  }
  if (goal.maxMinutesPerDay !== undefined) {
    chips.push({ key: "max-day", label: `≤ ${formatMinutes(goal.maxMinutesPerDay)}/day` });
  }
  if (goal.frequencyPerWeek !== undefined) {
    chips.push({ key: "frequency", label: `${goal.frequencyPerWeek}×/wk` });
  }
  const pinnedDays = goal.daysOfWeek?.length
    ? goal.daysOfWeek
    : goal.dayOfWeek
      ? [goal.dayOfWeek]
      : [];
  if (pinnedDays.length > 0) {
    const dayLabel = pinnedDays.map((d) => DAY_LABELS[d] ?? d).join(" ");
    chips.push({ key: "day", label: dayLabel });
  }
  if (goal.energyMode && goal.energyMode !== "neutral") {
    chips.push({ key: "energy", label: ENERGY_LABELS[goal.energyMode] });
  }
  if (goal.energyPolarity && goal.energyPolarity !== "neutral") {
    chips.push({
      key: "polarity",
      label: ENERGY_POLARITY_LABELS[goal.energyPolarity]
    });
  }
  if (goal.attentionMode && goal.attentionMode !== "unspecified") {
    chips.push({
      key: "attention",
      label: ATTENTION_MODE_LABELS[goal.attentionMode]
    });
  }
  if (goal.workLayer && goal.workLayer !== "unspecified") {
    chips.push({ key: "layer", label: WORK_LAYER_LABELS[goal.workLayer] });
  }
  if (goal.wheelAreaId) {
    const label = wheelLabel?.(goal.wheelAreaId) ?? goal.wheelAreaId;
    chips.push({ key: "wheel", label });
  }
  if (goal.ppfPillar) {
    chips.push({ key: "ppf", label: PPF_LABELS[goal.ppfPillar] });
  }
  return chips;
}

/** Collapsed list row: time and cadence only (framework matrix tags live under expand). */
export function summaryChipsForGoal(goal: WeeklyGoal, wheelLabel?: (id: string) => string): Chip[] {
  return chipsForGoal(goal, wheelLabel).filter((c) => SUMMARY_ROW_CHIP_KEYS.has(c.key));
}

export const SPECIAL_GOAL_PRESETS: ReadonlyArray<{
  type: SpecialGoalType;
  label: string;
  title: string;
  description: string;
  draft: Pick<
    WeeklyGoal,
    "specialGoalType" | "anchor" | "earliestHour" | "latestHour" | "energyMode"
  >;
}> = [
  {
    type: "gym",
    label: "Gym",
    title: "Gym",
    description: "Run around your preferred training windows.",
    draft: {
      specialGoalType: "gym",
      anchor: "gym-preferred-window",
      earliestHour: 6,
      latestHour: 20,
      energyMode: "hyperfocus"
    }
  },
  {
    type: "errands",
    label: "Errands",
    title: "Errands",
    description: "Run around drive events and transitions.",
    draft: {
      specialGoalType: "errands",
      anchor: "around-drive-events",
      energyMode: "hyperaware"
    }
  }
];

/**
 * Live time-budget chip math, mirroring the allocator at a high level for the
 * UI. The real allocator runs server-side; this client-side approximation
 * tells the user how many hours each unconstrained goal will get.
 *
 * - `freeMinutes`: total free time across the week (server-computed).
 * - `allocationMode` (default `"even"`):
 *   - `"even"`: goals with a `min` reserve their floor first; remaining minutes
 *     split equally across goals that aren't already capped.
 *   - `"finish-early"`: goals are filled in user/priority order up to their
 *     cap. Unbounded goals stay at their floor; leftover free time is shown as
 *     "free time at end".
 */
export function summariseAllocation(
  goals: readonly WeeklyGoal[],
  freeMinutes: number,
  allocationMode: "even" | "finish-early" = "even"
): {
  freeMinutes: number;
  goalCount: number;
  reservedMinutes: number;
  remainingMinutes: number;
  equalShareGoals: number;
  perEqualShareMinutes: number;
  allocationMode: "even" | "finish-early";
  finishEarlyLeftoverMinutes: number;
} {
  const schedulingGoals = filterSchedulingGoals(goals);
  let reserved = 0;
  let equalShareCount = 0;
  let plannedFromCaps = 0;
  for (const g of schedulingGoals) {
    const norm = normaliseGoalTime(g);
    const floor = norm.minMinutesPerWeek ?? 0;
    reserved += floor;
    const ceiling = norm.maxMinutesPerWeek;
    if (ceiling === undefined || floor < ceiling) equalShareCount++;
    // For finish-early projection we only top up goals that have an explicit
    // cap; unbounded goals stay at their floor.
    if (ceiling !== undefined) {
      plannedFromCaps += Math.max(0, ceiling - floor);
    }
  }
  const remaining = Math.max(0, freeMinutes - reserved);
  const perEqual = equalShareCount > 0 ? Math.round(remaining / equalShareCount) : 0;
  const finishEarlyLeftover =
    allocationMode === "finish-early" ? Math.max(0, remaining - plannedFromCaps) : 0;
  return {
    freeMinutes,
    goalCount: schedulingGoals.length,
    reservedMinutes: reserved,
    remainingMinutes: remaining,
    equalShareGoals: equalShareCount,
    perEqualShareMinutes: perEqual,
    allocationMode,
    finishEarlyLeftoverMinutes: finishEarlyLeftover
  };
}

/**
 * Starter goal ideas for the empty state. Picked to span work, body, mind,
 * relationships, and personal admin — the categories users typically forget
 * about until they see them named.
 */
export const STARTER_GOALS: ReadonlyArray<{ title: string; energy?: EnergyMode }> = [
  { title: "Deep work", energy: "hyperfocus" },
  { title: "Exercise" },
  { title: "Read" },
  { title: "Family time" },
  { title: "Plan & reflect" },
  { title: "Outdoor walk" },
  { title: "Admin", energy: "hyperaware" },
  { title: "Side project", energy: "hyperfocus" }
];
