/**
 * Pure helpers for the Perfect Week page.
 *
 * Used by both the server component (for chip rendering during initial paint)
 * and the client component (for live updates as the user types). Anything that
 * computes UI strings or summary numbers belongs here so the rendering layer
 * stays declarative.
 */

import type {
  EnergyMode,
  PpfPillarKey,
  SpecialGoalType,
  WeeklyGoal
} from "@calendar-automations/schema";
import { normaliseGoalTime } from "@calendar-automations/schema";

export type ChipKind =
  | "min-week"
  | "max-week"
  | "min-day"
  | "max-day"
  | "frequency"
  | "day"
  | "energy"
  | "wheel"
  | "ppf"
  | "special";

export interface Chip {
  /** Stable identifier used as React key and for drawer focus. */
  key: ChipKind;
  /** What we render inside the chip. */
  label: string;
}

const ENERGY_LABELS: Record<EnergyMode, string> = {
  hyperfocus: "Deep focus",
  neutral: "Neutral",
  hyperaware: "Scanning"
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
  errands: "Errands"
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
  if (goal.wheelAreaId) {
    const label = wheelLabel?.(goal.wheelAreaId) ?? goal.wheelAreaId;
    chips.push({ key: "wheel", label });
  }
  if (goal.ppfPillar) {
    chips.push({ key: "ppf", label: PPF_LABELS[goal.ppfPillar] });
  }
  return chips;
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
 * UI. The real allocator runs server-side; this client-side approximation just
 * tells the user how many hours each unconstrained goal will get.
 *
 * - `freeMinutes`: total free time across the week (server-computed).
 * - Goals with a `min` reserve their floor first.
 * - Remaining minutes split equally across remaining goals.
 */
export function summariseAllocation(
  goals: readonly WeeklyGoal[],
  freeMinutes: number
): {
  freeMinutes: number;
  goalCount: number;
  reservedMinutes: number;
  remainingMinutes: number;
  equalShareGoals: number;
  perEqualShareMinutes: number;
} {
  let reserved = 0;
  let equalShareCount = 0;
  for (const g of goals) {
    const norm = normaliseGoalTime(g);
    const floor = norm.minMinutesPerWeek ?? 0;
    reserved += floor;
    // Anyone whose ceiling isn't already met by their floor will receive more
    // time in the equal-share pass. For the headline summary we just count
    // goals that don't have a fixed target.
    const ceiling = norm.maxMinutesPerWeek;
    if (ceiling === undefined || floor < ceiling) equalShareCount++;
  }
  const remaining = Math.max(0, freeMinutes - reserved);
  const perEqual = equalShareCount > 0 ? Math.round(remaining / equalShareCount) : 0;
  return {
    freeMinutes,
    goalCount: goals.length,
    reservedMinutes: reserved,
    remainingMinutes: remaining,
    equalShareGoals: equalShareCount,
    perEqualShareMinutes: perEqual
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
