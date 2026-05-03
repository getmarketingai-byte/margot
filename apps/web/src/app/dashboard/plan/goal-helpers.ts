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
  GoalGroup,
  PpfPillarKey,
  SpecialGoalType,
  WeeklyGoal,
  WorkLayer
} from "@calendar-automations/schema";
import {
  effectivePlacementIdealAfterBoundary,
  effectivePlacementIdealBeforeBoundary,
  filterSchedulingGoals,
  normaliseGoalTime
} from "@calendar-automations/schema";
import { computePass2AllocMinutesFromShareOfWeek } from "@calendar-automations/planner/weekly";

function formatPlacementIdealClockBoundsSuffix(
  goal: Pick<
    WeeklyGoal,
    "placementIdealClockAfter" | "placementIdealClockBefore" | "placementIdealClockFilter"
  >
): string {
  const after = effectivePlacementIdealAfterBoundary(goal);
  const before = effectivePlacementIdealBeforeBoundary(goal);
  const clock = (t: { hour: number; minute: number }) =>
    `${t.hour}:${String(t.minute).padStart(2, "0")}`;
  const bits: string[] = [];
  if (after) bits.push(`after ${clock(after)}`);
  if (before) bits.push(`before ${clock(before)}`);
  if (bits.length === 0) return "";
  return ` (${bits.join(", ")})`;
}

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
      label: `${goal.allocationSharePercent}% of week`
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
    const suf = formatPlacementIdealClockBoundsSuffix(goal);
    chips.push({
      key: "ideal-times",
      label:
        labels.length > 3
          ? `Ideal ~${shown}…${suf}`
          : `Ideal ${shown}${suf}`
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
 * - `freeMinutes`: full-week **available** schedulable minutes after segments
 *   (`weekCapacityMinutes` — calendar busy, sleep, travel, etc.), Pass 1+2 denominator.
 * - After weekly minimums are reserved, remaining minutes R are split across
 *   goals that are not already capped and are eligible for remainder share:
 *   no weekly floor, or explicit `allocationSharePercent`. `%` rows target a
 *   fraction of full-week schedulable time T (`freeMinutes`); the cohort never
 *   receives more than R (same as planner Pass 2).
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
  /** Sum of explicit `allocationSharePercent` values (>100 means overflow). */
  allocationSharePercentSum: number;
  /** True when sum of explicit `% of week` values exceeds 100. */
  allocationSharePercentOverflow: boolean;
  /**
   * Equal-time slice of full-week schedulable minutes (`freeMinutes / N`) for
   * `N` remainder-eligible goals — baseline for "more than equal share" hints.
   */
  equalSliceOfWeekMinutes: number;
  /**
   * Pass-2-style minutes from `remainingMinutes` for each goal that participates
   * in the post-floor remainder (`% of week` vs equal split of leftovers; same as
   * `computePass2AllocMinutesFromShareOfWeek`).
   * Goals with a weekly floor and no `% share` are omitted — they do not take remainder.
   */
  remainderHintByGoalId: Record<string, number>;
  /** True when any scheduling goal references at least one goal group. */
  hasAnyGoalGroupMembership: boolean;
} {
  const schedulingGoals = filterSchedulingGoals(goals);
  const hasWeightedShare = schedulingGoals.some((g) => g.allocationSharePercent !== undefined);
  let reserved = 0;
  let equalShareCount = 0;
  const eligibleForRemainder: WeeklyGoal[] = [];
  for (const g of schedulingGoals) {
    const norm = normaliseGoalTime(g);
    const floor = norm.minMinutesPerWeek ?? 0;
    reserved += floor;
    const ceiling = norm.maxMinutesPerWeek;
    const participatesInRemainder =
      floor <= 0 || g.allocationSharePercent !== undefined;
    if (participatesInRemainder && (ceiling === undefined || floor < ceiling)) {
      equalShareCount++;
      eligibleForRemainder.push(g);
    }
  }
  const remaining = Math.max(0, freeMinutes - reserved);
  const perEqual = equalShareCount > 0 ? Math.round(remaining / equalShareCount) : 0;
  const equalSliceOfWeekMinutes =
    equalShareCount > 0 ? Math.round(freeMinutes / equalShareCount) : 0;

  let allocationSharePercentSum = 0;
  for (const g of schedulingGoals) {
    if (g.allocationSharePercent !== undefined) {
      allocationSharePercentSum += g.allocationSharePercent;
    }
  }
  const allocationSharePercentOverflow = allocationSharePercentSum > 100;

  const remainderHintByGoalId: Record<string, number> = {};
  if (eligibleForRemainder.length > 0 && remaining > 0) {
    const mins = computePass2AllocMinutesFromShareOfWeek(
      eligibleForRemainder,
      freeMinutes,
      remaining
    );
    for (let i = 0; i < eligibleForRemainder.length; i++) {
      const id = eligibleForRemainder[i]!.id;
      remainderHintByGoalId[id] = Math.round(mins[i]!);
    }
  }

  const hasAnyGoalGroupMembership = schedulingGoals.some((g) => (g.groupIds?.length ?? 0) > 0);

  return {
    freeMinutes,
    goalCount: schedulingGoals.length,
    reservedMinutes: reserved,
    remainingMinutes: remaining,
    equalShareGoals: equalShareCount,
    perEqualShareMinutes: perEqual,
    hasWeightedShare,
    allocationSharePercentSum,
    allocationSharePercentOverflow,
    equalSliceOfWeekMinutes,
    remainderHintByGoalId,
    hasAnyGoalGroupMembership
  };
}

/** Narrow summary shape consumed by [`goalAllocationRowDisplay`]. */
export type GoalAllocationRowSummary = Pick<
  ReturnType<typeof summariseAllocation>,
  | "equalShareGoals"
  | "perEqualShareMinutes"
  | "hasWeightedShare"
  | "remainderHintByGoalId"
  | "equalSliceOfWeekMinutes"
  | "allocationSharePercentOverflow"
  | "allocationSharePercentSum"
  | "freeMinutes"
  | "hasAnyGoalGroupMembership"
>;

/** Day-sheet vs future blocks from the planner (see `WeekMetrics.perGoal`). */
export type GoalPlanMinutes = {
  loggedMinutes: number;
  proposedFutureMinutes: number;
};

/** Collapsed goal row: logged, proposed (future blocks), weekly min, weekly max / share hint. */
export type GoalAllocationRowDisplay = {
  loggedLabel: string;
  proposedLabel: string;
  minTargetLabel: string;
  maxTargetLabel: string;
  title: string;
};

const PLANNER_VS_HINT_SLACK_MIN = 15;

function aggregateSchedulingPartsForGoalGroup(grp: GoalGroup): string[] {
  const parts: string[] = [];
  if (grp.minMinutesPerWeek !== undefined) {
    parts.push(`∑ ≥ ${formatMinutes(grp.minMinutesPerWeek)}/wk`);
  }
  if (grp.maxMinutesPerWeek !== undefined) {
    parts.push(`∑ ≤ ${formatMinutes(grp.maxMinutesPerWeek)}/wk`);
  }
  if (grp.minMinutesPerDay !== undefined) {
    parts.push(`∑ ≥ ${formatMinutes(grp.minMinutesPerDay)}/day`);
  }
  if (grp.maxMinutesPerDay !== undefined) {
    parts.push(`∑ ≤ ${formatMinutes(grp.maxMinutesPerDay)}/day`);
  }
  if (grp.allocationSharePercent !== undefined) {
    parts.push(`∑ ${grp.allocationSharePercent}% of week`);
  }
  if (grp.frequencyPerWeek !== undefined) {
    parts.push(`∑ ${grp.frequencyPerWeek}×/wk`);
  }
  const pinnedDays = grp.daysOfWeek?.length
    ? grp.daysOfWeek
    : grp.dayOfWeek
      ? [grp.dayOfWeek]
      : [];
  if (pinnedDays.length > 0) {
    parts.push(`∑ ${pinnedDays.map((d) => DAY_LABELS[d] ?? d).join(" ")}`);
  }
  if (grp.earliestHour !== undefined || grp.latestHour !== undefined) {
    const e =
      grp.earliestHour !== undefined ? `${grp.earliestHour}:00` : "…";
    const l = grp.latestHour !== undefined ? `${grp.latestHour}:00` : "…";
    parts.push(`∑ ${e}–${l}`);
  }
  if (grp.scheduleInNiceWeather === true) {
    parts.push("∑ Nice weather");
  }
  if (grp.placementIdealClockTimes && grp.placementIdealClockTimes.length > 0) {
    const labels = grp.placementIdealClockTimes.map(
      (t) => `${t.hour}:${String(t.minute).padStart(2, "0")}`
    );
    const shown = labels.slice(0, 3).join(", ");
    const suf = formatPlacementIdealClockBoundsSuffix(grp);
    parts.push(
      labels.length > 3 ? `∑ Ideal ~${shown}…${suf}` : `∑ Ideal ${shown}${suf}`
    );
  }
  return parts;
}

/** One-line cohort rule summary for a goal group (no title prefix). Null when no scheduling fields set. */
export function goalGroupAggregateSummaryLine(group: GoalGroup): string | null {
  const parts = aggregateSchedulingPartsForGoalGroup(group);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export interface AggregateGroupConstraintSummary {
  groupId: string;
  /** e.g. "Screens: ∑ ≤ 8h/wk · ∑ ≤ 2h/day" */
  line: string;
}

/**
 * Human-readable aggregate constraint lines for each goal group this goal belongs to.
 * Empty when the goal has no groups or groups have no scheduling fields.
 */
export function aggregateGroupConstraintSummariesForGoal(
  goal: WeeklyGoal,
  goalGroups: readonly GoalGroup[]
): AggregateGroupConstraintSummary[] {
  const ids = goal.groupIds ?? [];
  if (ids.length === 0 || goalGroups.length === 0) return [];
  const byId = new Map(goalGroups.map((g) => [g.id, g] as const));
  const out: AggregateGroupConstraintSummary[] = [];
  for (const gid of ids) {
    const grp = byId.get(gid);
    if (!grp) continue;
    const parts = aggregateSchedulingPartsForGoalGroup(grp);
    if (parts.length === 0) continue;
    out.push({ groupId: grp.id, line: `${grp.title}: ${parts.join(" · ")}` });
  }
  return out;
}

/**
 * Builds labels for the collapsed goals-list row: four values — day-sheet logged time,
 * allocator blocks from now through week end, weekly minimum, and weekly maximum or Pass-2 share hint.
 *
 * When `plannerTargetMinutes` is set (&gt; 0), the **Max** column matches the planner’s weekly target
 * for this goal (after weekly goal-group caps). Otherwise the max follows field hints and budget chips only.
 */
export function goalAllocationRowDisplay(
  goal: WeeklyGoal,
  summary: GoalAllocationRowSummary,
  planMinutes: GoalPlanMinutes,
  plannerTargetMinutes?: number
): GoalAllocationRowDisplay {
  const norm = normaliseGoalTime(goal);
  const minFloor = norm.minMinutesPerWeek ?? 0;
  const minTargetLabel = minFloor > 0 ? formatMinutes(minFloor) : "—";

  const hasExplicitWeeklyMax = norm.maxMinutesPerWeek !== undefined;
  const hintMap = summary.remainderHintByGoalId;
  const hasPerGoalHints = hintMap !== undefined;
  const idHint = hasPerGoalHints && Object.hasOwn(hintMap, goal.id) ? hintMap[goal.id] : undefined;

  const heuristicMaxMinutes =
    hasExplicitWeeklyMax
      ? norm.maxMinutesPerWeek!
      : idHint !== undefined
        ? idHint
        : !hasPerGoalHints && summary.equalShareGoals > 0
          ? summary.perEqualShareMinutes
          : undefined;

  const usePlannerTarget =
    plannerTargetMinutes !== undefined &&
    plannerTargetMinutes > 0 &&
    Number.isFinite(plannerTargetMinutes);

  const maxTargetLabel = usePlannerTarget
    ? formatMinutes(Math.max(0, Math.round(plannerTargetMinutes!)))
    : heuristicMaxMinutes !== undefined
      ? formatMinutes(Math.max(heuristicMaxMinutes, 0))
      : "—";

  const loggedLabel = formatMinutes(planMinutes.loggedMinutes);
  const proposedLabel = formatMinutes(planMinutes.proposedFutureMinutes);

  const thirdExplain = hasExplicitWeeklyMax
    ? "weekly ceiling"
    : hasPerGoalHints && idHint !== undefined
      ? "your approximate share after weekly minimums (% of full-week schedulable time, capped by what is left — same as planner Pass 2)"
      : heuristicMaxMinutes !== undefined
        ? "approx. minutes each unconstrained goal would get after minimums reserve time (budget chip)"
        : "";

  let title =
    "Logged: day-sheet time this week. Proposed: planner blocks from now through end of week (merged). ";
  title +=
    "Logged and proposed can occupy the same clock time — Total achieved uses one merged count elsewhere. ";
  title += `Min target: ${minFloor > 0 ? "weekly floor" : "none"}. `;

  if (usePlannerTarget) {
    title += `Max target: ${maxTargetLabel} — allocator weekly target for this goal (after Pass 1–2 and weekly goal-group caps; day-sheet credit affects placement demand separately).`;
    if (
      heuristicMaxMinutes !== undefined &&
      heuristicMaxMinutes - plannerTargetMinutes! > PLANNER_VS_HINT_SLACK_MIN
    ) {
      title += ` A field- and chip-only estimate would be up to ${formatMinutes(Math.max(0, heuristicMaxMinutes))} (${thirdExplain || "hint"}), higher because local hints ignore cohort pools.`;
    }
  } else {
    title += `Max target: ${
      heuristicMaxMinutes !== undefined
        ? `${maxTargetLabel} (${thirdExplain})`
        : "not set for this row"
    }.`;
  }

  if (goal.allocationSharePercent !== undefined) {
    title +=
      " `%` is a fraction of full-week schedulable time; Pass 2 never assigns more than the post–minimum pool; caps and placement can change the final plan.";
  } else if (summary.hasWeightedShare) {
    title +=
      " Some goals use `% of week`; others split whatever is left after those targets.";
  }

  return { loggedLabel, proposedLabel, minTargetLabel, maxTargetLabel, title };
}

const PASS2_WARN_SLACK_MIN = 15;

/**
 * True when the planner weekly target (minus floor) exceeds what this row’s
 * constraints imply: Pass‑2 remainder share from {@link summariseAllocation}
 * (`remainderHintByGoalId` / `perEqualShareMinutes`). For sub-100 `% of week`,
 * prefer that goal’s remainder hint (same Pass‑2 split as the planner); only if
 * no hint exists, fall back to `(pct/100)*freeMinutes`.
 * Skips explicit 100% (allowed to consume the whole post-floor pool).
 *
 * **Do not** compare to `equalSliceOfWeekMinutes` (`freeMinutes / N`); that ignores
 * floors reserved by other goals and inflates the baseline, so most rows spuriously
 * look “above fair share”.
 *
 * **`daySheetLoggedMinutesForShare`:** same ISO slice as `summary.freeMinutes` (the
 * cohort row’s `loggedMinutes`). When **`allocatorDemandMinutesBeforePass3`** is omitted,
 * subtracting this credit approximates allocator post–log demand while `targetMinutes`
 * can stay the full Pass 1+2 display figure.
 *
 * **`allocatorDemandMinutesBeforePass3`:** from `WeekMetrics.perGoal.demandMinutesBeforePass3`
 * (post–log and optional `allocationNowMs` scaling, before Pass 3). When provided, it
 * defines the Pass‑2‑comparable total for this row and overrides the display target /
 * day-sheet heuristic (covers from-now scaling where `targetMinutes` stays full-week).
 */
export function goalExceedsDeclaredWeekShare(
  goal: WeeklyGoal,
  summary: Pick<
    ReturnType<typeof summariseAllocation>,
    | "equalSliceOfWeekMinutes"
    | "freeMinutes"
    | "hasWeightedShare"
    | "remainderHintByGoalId"
    | "perEqualShareMinutes"
  >,
  effectiveTargetMinutes: number | undefined,
  daySheetLoggedMinutesForShare = 0,
  allocatorDemandMinutesBeforePass3?: number
): boolean {
  if (effectiveTargetMinutes === undefined) return false;
  if (goal.allocationSharePercent === 100) return false;
  const floor = normaliseGoalTime(goal).minMinutesPerWeek ?? 0;
  const rawPass2 = Math.max(0, effectiveTargetMinutes - floor);
  const logCred = Math.max(0, daySheetLoggedMinutesForShare);
  const pass2FromDisplay = Math.max(0, rawPass2 - Math.min(logCred, rawPass2));
  const pass2 =
    allocatorDemandMinutesBeforePass3 !== undefined
      ? Math.max(0, allocatorDemandMinutesBeforePass3 - floor)
      : pass2FromDisplay;
  const pct = goal.allocationSharePercent;
  if (pct !== undefined && pct < 100) {
    const pctHint = summary.remainderHintByGoalId[goal.id];
    const baseline =
      pctHint !== undefined ? pctHint : (pct / 100) * summary.freeMinutes;
    if (pass2 <= baseline) return false;
    const exceeds = pass2 > baseline + PASS2_WARN_SLACK_MIN;
    // #region agent log
    if (exceeds) {
      fetch("http://127.0.0.1:7257/ingest/a9e25fe2-a3a6-41a5-b2f2-fc188fac1d73", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "a035b6" },
        body: JSON.stringify({
          sessionId: "a035b6",
          location: "goal-helpers.ts:goalExceedsDeclaredWeekShare",
          message: "pct row exceeds share baseline",
          data: {
            goalId: goal.id,
            pct,
            usedHint: pctHint !== undefined,
            baseline,
            capPctT: (pct / 100) * summary.freeMinutes,
            pass2,
            rawPass2,
            logCred,
            demandM: allocatorDemandMinutesBeforePass3,
            floor,
            effectiveTargetMinutes,
            freeMinutes: summary.freeMinutes
          },
          timestamp: Date.now(),
          hypothesisId: "pct-hint"
        })
      }).catch(() => {});
    }
    // #endregion
    return exceeds;
  }
  if (summary.hasWeightedShare && pct === undefined) return false;

  const hint = summary.remainderHintByGoalId[goal.id];
  const baseline =
    hint !== undefined
      ? hint
      : summary.perEqualShareMinutes > 0
        ? summary.perEqualShareMinutes
        : summary.equalSliceOfWeekMinutes;
  if (pass2 <= baseline) return false;
  const exceedsEq = pass2 > baseline + PASS2_WARN_SLACK_MIN;
  // #region agent log
  if (exceedsEq) {
    fetch("http://127.0.0.1:7257/ingest/a9e25fe2-a3a6-41a5-b2f2-fc188fac1d73", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "a035b6" },
      body: JSON.stringify({
        sessionId: "a035b6",
        location: "goal-helpers.ts:goalExceedsDeclaredWeekShare",
        message: "equal-share row exceeds baseline",
        data: {
          goalId: goal.id,
          baseline,
          hintDefined: hint !== undefined,
          pass2,
          rawPass2: Math.max(0, effectiveTargetMinutes - floor),
          logCred: Math.max(0, daySheetLoggedMinutesForShare),
          pass2FromDisplay,
          demandM: allocatorDemandMinutesBeforePass3,
          floor,
          effectiveTargetMinutes,
          hasWeightedShare: summary.hasWeightedShare,
          freeMinutes: summary.freeMinutes
        },
        timestamp: Date.now(),
        hypothesisId: "eq-baseline"
      })
    }).catch(() => {});
  }
  // #endregion
  return exceedsEq;
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
