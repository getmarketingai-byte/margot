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
  | "nice-weather"
  | "ideal-times"
  | "share"
  | "energy"
  | "polarity"
  | "attention"
  | "layer"
  | "wheel"
  | "ppf"
  | "special"
  | "focus-aff"
  | "battery-charge"
  | "battery-drain";

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
  "day",
  "nice-weather",
  "ideal-times",
  "share"
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
  gym: "Physical activity",
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
  if (goal.allocationSharePercent !== undefined) {
    chips.push({
      key: "share",
      label: `${goal.allocationSharePercent}% of remainder`
    });
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
  if (goal.scheduleInNiceWeather === true) {
    chips.push({ key: "nice-weather", label: "Nice weather" });
  }
  if (goal.placementIdealClockTimes && goal.placementIdealClockTimes.length > 0) {
    const labels = goal.placementIdealClockTimes.map(
      (t) => `${t.hour}:${String(t.minute).padStart(2, "0")}`
    );
    const shown = labels.slice(0, 3).join(", ");
    chips.push({
      key: "ideal-times",
      label:
        labels.length > 3
          ? `Ideal ~${shown}…`
          : `Ideal ${shown}`
    });
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
  if (goal.focusAffinity && goal.focusAffinity !== "unspecified") {
    const lab =
      goal.focusAffinity === "hyperfocus"
        ? "Focus affinity · deep"
        : goal.focusAffinity === "hyperaware"
          ? "Focus affinity · aware"
          : "Focus affinity · mixed";
    chips.push({ key: "focus-aff", label: lab });
  }
  if (goal.energyChargeImpact !== undefined) {
    chips.push({
      key: "battery-charge",
      label: `Charge ${goal.energyChargeImpact.toFixed(2)}`
    });
  }
  if (goal.energyDrainImpact !== undefined) {
    chips.push({
      key: "battery-drain",
      label: `Drain ${goal.energyDrainImpact.toFixed(2)}`
    });
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

/**
 * Live time-budget chip math, mirroring the allocator at a high level for the
 * UI. The real allocator runs server-side; this client-side approximation
 * tells the user how many hours each unconstrained goal will get.
 *
 * - `freeMinutes`: full-week free gap capacity after segments (`weekCapacityMinutes`), same denominator as Pass 1+2.
 * - After weekly minimums are reserved, remaining minutes are split fairly across
 *   goals that are not already capped and are eligible for remainder share:
 *   no weekly floor, or explicit `allocationSharePercent`.
 * - Calendar packing (buffers between goal blocks vs slack at the end of a free
 *   window) is controlled separately by settings and does not change these numbers.
 */
export function summariseAllocation(goals: readonly WeeklyGoal[], freeMinutes: number): {
  freeMinutes: number;
  goalCount: number;
  reservedMinutes: number;
  remainingMinutes: number;
  equalShareGoals: number;
  perEqualShareMinutes: number;
  /** True when some scheduling goal sets `allocationSharePercent`. */
  hasWeightedShare: boolean;
} {
  const schedulingGoals = filterSchedulingGoals(goals);
  const hasWeightedShare = schedulingGoals.some((g) => g.allocationSharePercent !== undefined);
  let reserved = 0;
  let equalShareCount = 0;
  for (const g of schedulingGoals) {
    const norm = normaliseGoalTime(g);
    const floor = norm.minMinutesPerWeek ?? 0;
    reserved += floor;
    const ceiling = norm.maxMinutesPerWeek;
    const participatesInRemainder =
      floor <= 0 || g.allocationSharePercent !== undefined;
    if (participatesInRemainder && (ceiling === undefined || floor < ceiling)) {
      equalShareCount++;
    }
  }
  const remaining = Math.max(0, freeMinutes - reserved);
  const perEqual = equalShareCount > 0 ? Math.round(remaining / equalShareCount) : 0;
  return {
    freeMinutes,
    goalCount: schedulingGoals.length,
    reservedMinutes: reserved,
    remainingMinutes: remaining,
    equalShareGoals: equalShareCount,
    perEqualShareMinutes: perEqual,
    hasWeightedShare
  };
}

/** Narrow summary shape consumed by [`goalAllocationRowDisplay`]. */
export type GoalAllocationRowSummary = Pick<
  ReturnType<typeof summariseAllocation>,
  "equalShareGoals" | "perEqualShareMinutes" | "hasWeightedShare"
>;

/**
 * Builds the collapsed goals-list time string: achieved / weekly min — weekly max (or unconstrained-share hint).
 *
 * Third segment is an explicit `maxMinutesPerWeek` when set; otherwise minutes per unconstrained-equal-share participant
 * from [`summariseAllocation`] (same basis as “Each unconstrained goal” in the budget chip). Omit the third segment when
 * there is no explicit max and no unconstrained-equal-share cohort (shows `- 0` otherwise avoided).
 */
export function goalAllocationRowDisplay(
  goal: WeeklyGoal,
  summary: GoalAllocationRowSummary,
  scheduledMinutes: number
): { line: string; title: string } {
  const norm = normaliseGoalTime(goal);
  const minFloor = norm.minMinutesPerWeek ?? 0;
  const minLabel = minFloor > 0 ? formatMinutes(minFloor) : "—";

  const hasExplicitWeeklyMax = norm.maxMinutesPerWeek !== undefined;
  const maxMinutes =
    hasExplicitWeeklyMax
      ? norm.maxMinutesPerWeek!
      : summary.equalShareGoals > 0
        ? summary.perEqualShareMinutes
        : undefined;

  const scheduledLabel = formatMinutes(scheduledMinutes);
  const maxLabel =
    maxMinutes !== undefined ? formatMinutes(Math.max(maxMinutes, 0)) : undefined;

  const line =
    maxLabel !== undefined ? `${scheduledLabel} / ${minLabel} - ${maxLabel}` : `${scheduledLabel} / ${minLabel}`;

  const thirdExplain = hasExplicitWeeklyMax
    ? "weekly ceiling"
    : "approx. minutes each unconstrained goal would get after minimums reserve time (budget chip)";
  let title = `Scheduled (logs plus calendar blocks) / Weekly minimum (${minFloor > 0 ? "explicit floor" : "none"}`;
  title += `) • Upper: ${maxLabel !== undefined ? `${maxLabel} — ${thirdExplain}` : "not shown (no unconstrained-equal-share cohort and no weekly max)"}`;

  if (goal.allocationSharePercent !== undefined) {
    title +=
      ". This row also takes a weighted % of remainder; the planner’s merged target may differ — see expanded options.";
  } else if (summary.hasWeightedShare) {
    title +=
      ". Some goals use `% of remainder`; unconstrained-equal-share hints are approximate for the whole pool.";
  }

  return { line, title };
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
