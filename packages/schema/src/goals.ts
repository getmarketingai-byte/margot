/**
 * Weekly plan + goal schema.
 *
 * One WeeklyPlan per Monday-anchored ISO week. Each goal carries the orthogonal
 * framework tags described in the plan: energyMode (Bustamante), wheelArea
 * (Robbins), ppfPillar (Dawson), and hp6Habit (Burchard).
 */

import { z } from "zod";
import { hp6HabitKey, ppfHorizonKey, ppfPillarKey } from "./settings";

export const energyMode = z.enum(["hyperfocus", "hyperaware", "neutral"]);
export type EnergyMode = z.infer<typeof energyMode>;

/**
 * Manual classification of how a goal affects the user's energy budget.
 *
 * - "energise" goals add energy (e.g. play, exercise, meaningful contribution).
 * - "drain"    goals deplete energy (e.g. heavy ops, taxing meetings).
 * - "neutral"  is the default for unclassified goals.
 *
 * Used by the second-page Energy board and consumed by the suggestion layer
 * to avoid stacking too many "drain" goals back-to-back.
 */
export const energyPolarity = z.enum(["energise", "drain", "neutral"]);
export type EnergyPolarity = z.infer<typeof energyPolarity>;

/**
 * Andrew Bustamante's hyper focus / hyper awareness distinction, surfaced as
 * a manual goal-level tag. This is intentionally separate from the existing
 * `energyMode` field (which the allocator already biases windows for):
 * `energyMode` is implicit and editable inline, while `attentionMode` is the
 * explicit framework selector on the Energy board. Either may be left
 * unspecified.
 */
export const attentionMode = z.enum(["hyperfocus", "hyperaware", "unspecified"]);
export type AttentionMode = z.infer<typeof attentionMode>;

/**
 * The four-layer work taxonomy the user wants to batch around:
 *   1. needle-mover   — deep, high-leverage work
 *   2. execution      — shipping the next concrete steps
 *   3. ops            — operations / future-building / housekeeping
 *   4. play           — recovery, fun, creative roaming
 *
 * Mirrors the legacy timemap band ids so users can think in the same
 * vocabulary across both the time-map and goal-classification surfaces.
 */
export const workLayer = z.enum([
  "needle-mover",
  "execution",
  "ops",
  "play",
  "unspecified"
]);
export type WorkLayer = z.infer<typeof workLayer>;

export const dayOfWeek = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
]);
export type DayOfWeek = z.infer<typeof dayOfWeek>;

/**
 * When set together with `placementIdealClockTimes`, only ideal times on the matching
 * side of this local wall clock participate in placement nudges. Prefer
 * `placementIdealClockAfter` / `placementIdealClockBefore` for independent bounds.
 */
export const placementIdealClockFilterSchema = z.object({
  kind: z.enum(["after", "before"]),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59)
});
export type PlacementIdealClockFilter = z.infer<typeof placementIdealClockFilterSchema>;

/** Local wall-clock boundary (hour + minute) for ideal-time placement hints. */
export const placementIdealClockBoundarySchema = z.object({
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59)
});
export type PlacementIdealClockBoundary = z.infer<typeof placementIdealClockBoundarySchema>;

export const specialGoalType = z.enum([
  "morning-routine",
  "shutdown-routine",
  "gym",
  /** Synthetic row for invert-free-busy calendar sources (readout, not a commitment). */
  "inverted-timemap"
]);
export type SpecialGoalType = z.infer<typeof specialGoalType>;

/** Strips legacy `"errands"` (was a settings-driven block; use a normal goal instead). */
const specialGoalTypeFieldSchema = z.preprocess(
  (v) => (v === "errands" ? undefined : v),
  specialGoalType.optional()
);

/**
 * How firmly the user is committing to this goal this week.
 *
 * The allocator uses this as the primary tie-breaker when free time is
 * scarce: `non_negotiable` goals get first access to gaps, then `committed`,
 * then `nice_to_have`. Within a tier the existing list-order signal still
 * applies, so users can keep ranking goals with the existing Perfect Week
 * drag handles.
 */
export const commitmentLevel = z.enum([
  "non_negotiable",
  "committed",
  "nice_to_have"
]);
export type CommitmentLevel = z.infer<typeof commitmentLevel>;

export const weeklyGoalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  /**
   * Hint-only weekly minutes from quick add / older UIs. Does **not** set a
   * weekly floor or ceiling unless `minMinutesPerWeek` / `maxMinutesPerWeek`
   * are also set; see `normaliseGoalTime`.
   */
  targetMinutes: z.number().int().positive().optional(),
  /** Reserve at least this many minutes per week (allocator Pass 1). */
  minMinutesPerWeek: z.number().int().nonnegative().optional(),
  /** Cap weekly minutes at this ceiling (allocator Pass 2). */
  maxMinutesPerWeek: z.number().int().positive().optional(),
  /** Daily floor; allocator tries to land at least this much on each scheduled day. */
  minMinutesPerDay: z.number().int().nonnegative().optional(),
  /** Daily cap; allocator never schedules more than this much on a single day. */
  maxMinutesPerDay: z.number().int().positive().optional(),
  /**
   * Prefer each **auto** block to be at least this long (15‑minute grid) while enough
   * weekly demand remains; smaller gaps are skipped until the tail so deep-work style
   * goals are not shredded into crumbs before gym or other peers run.
   */
  minMinutesPerBlock: z.number().int().positive().max(600).optional(),
  /**
   * Max auto-generated blocks per calendar day for this goal (pins do not count).
   * Omit for no cap. When `minMinutesPerBlock` is set and this is omitted, the
   * allocator defaults to **2** so the same day can hold e.g. work → gym → work.
   */
  maxAutoBlocksPerDay: z.number().int().min(1).max(8).optional(),
  /** "Show up N days a week"; if set, the goal's weekly minutes split across N days. */
  frequencyPerWeek: z.number().int().min(1).max(14).optional(),
  /** When set, the goal must land on this day; otherwise the allocator floats it. */
  dayOfWeek: dayOfWeek.optional(),
  /**
   * Optional set of allowed weekdays. This supersedes `dayOfWeek` when present
   * and lets a goal be pinned to multiple days.
   */
  daysOfWeek: z.array(dayOfWeek).min(1).max(7).optional(),
  /**
   * Legacy 1–5 priority. The new UI surfaces priority as goal order only; this
   * field stays for back-compat but defaults to 3 and is no longer required.
   */
  priority: z.number().int().min(1).max(5).default(3).optional(),
  energyMode: energyMode.default("neutral"),
  /**
   * Manual energy-polarity classification (energise vs drain). Defaults to
   * "neutral" so goals created before this field existed round-trip cleanly.
   */
  energyPolarity: energyPolarity.default("neutral"),
  /**
   * Manual hyper-focus vs hyper-awareness selection. Distinct from the
   * implicit `energyMode` chip; defaults to "unspecified".
   */
  attentionMode: attentionMode.default("unspecified"),
  /**
   * Manual four-layer work classification (needle-mover / execution / ops /
   * play). Defaults to "unspecified" for back-compat with prior plans.
   */
  workLayer: workLayer.default("unspecified"),
  wheelAreaId: z.string().optional(),
  ppfPillar: ppfPillarKey.optional(),
  ppfHorizon: ppfHorizonKey.default("unspecified"),
  hp6Habit: hp6HabitKey.optional(),
  /** Inclusive earliest hour (0-23). */
  earliestHour: z.number().int().min(0).max(23).optional(),
  /** Exclusive latest hour (0-24). */
  latestHour: z.number().int().min(0).max(24).optional(),
  /** Free-form anchor hint, e.g. "after-work", "morning". Display-only for v1. */
  anchor: z.string().optional(),
  /**
   * Optional preferred local start times (wall clock) used when scoring gaps
   * and when placing the block inside a wide free window (start is clamped to
   * the gap when ideal falls outside). Used for `specialGoalType: "gym"` goals
   * (Perfect Week row or legacy settings-driven synthetic).
   */
  placementIdealClockTimes: z
    .array(
      z.object({
        hour: z.number().int().min(0).max(23),
        minute: z.number().int().min(0).max(59)
      })
    )
    .max(8)
    .optional(),
  /**
   * Optional filter: only ideal clock rows matching `kind` relative to the boundary
   * are used for gap scoring and in-gap start alignment (weak signal).
   *
   * Prefer {@link placementIdealClockAfter} / {@link placementIdealClockBefore}; this field
   * remains for older saved plans.
   */
  placementIdealClockFilter: placementIdealClockFilterSchema.optional(),
  /**
   * Lower bound (inclusive) for which listed `placementIdealClockTimes` participate in soft nudges.
   * When **both** this and `placementIdealClockBefore` are set (before strictly later on the clock),
   * the weekly allocator **hard-clips** free gaps to that local window for this goal.
   */
  placementIdealClockAfter: placementIdealClockBoundarySchema.optional(),
  /**
   * Upper bound (exclusive) for which listed `placementIdealClockTimes` participate in soft nudges.
   * When paired with `placementIdealClockAfter` as above, placement is hard-clipped to that window
   * and the weekly allocator tightens `maxMinutesPerWeek` to the total placeable minutes in that band.
   */
  placementIdealClockBefore: placementIdealClockBoundarySchema.optional(),
  /**
   * Optional semantic type used by the UI for routine presets that map to
   * existing timemap/sleep/travel patterns.
   */
  specialGoalType: specialGoalTypeFieldSchema,
  /**
   * Commitment tier (non-negotiable / committed / nice-to-have). Defaults to
   * "committed" so existing goals round-trip cleanly. Drives placement order
   * in the weekly allocator and surfaces as a board on the planning hub.
   */
  commitmentLevel: commitmentLevel.default("committed"),
  /**
   * Pass 2: fraction (1–100) of **full-week schedulable gap time** (same denominator
   * as weekly capacity), not “% of what’s left after floors”. The cohort never
   * receives more than the post–minimum remainder; several % rows should sum to ≤100%.
   * Calendar packing (`allocator.allocationMode`) is separate.
   */
  allocationSharePercent: z.number().int().min(1).max(100).optional(),
  /**
   * When true, the weekly allocator only places this goal in intervals that
   * overlap the user's timemap "[Outside]" windows (same definition as
   * Settings → Weather). Callers pass merged forecast intervals into
   * `allocateWeek({ niceWeatherWindows })`. If that list is empty (weather
   * disabled, no overlap, etc.), the flag is ignored so goals are not starved.
   */
  scheduleInNiceWeather: z.boolean().optional(),
  /**
   * Optional explicit 0–1 “recharges focus battery” strength for personal energy scheduling.
   * When omitted, inferred from attention/energy/polarity tags.
   */
  energyChargeImpact: z.number().min(0).max(1).optional(),
  /**
   * Optional explicit 0–1 “drains awareness / social battery” strength for personal energy scheduling.
   */
  energyDrainImpact: z.number().min(0).max(1).optional(),
  /**
   * Shortcut affinity when explicit charge/drain impacts are omitted.
   */
  focusAffinity: z.enum(["hyperfocus", "hyperaware", "mixed", "unspecified"]).optional(),
  /**
   * IDs of [`GoalGroup`](goalGroupSchema) on the same [`WeeklyPlan`]. A goal may
   * belong to several groups; aggregate constraints intersect (tightest wins).
   */
  groupIds: z.array(z.string().min(1)).max(16).optional(),
  /**
   * Only when `UserSettings.allocator.goalWindowMode === "hybrid"`: Pass 3 treats
   * this goal as **linear-role** (greedy auto blocks + pins) or **stacked-role**
   * (pins-only + feasible ribbons). Omit ⇒ **`stacked`** (Skedpal-first).
   * Ignored when global mode is `linear` or `stacked`.
   *
   * @see [`ALLOCATOR_BUSINESS_RULES.md`](../../planner/ALLOCATOR_BUSINESS_RULES.md) — vocabulary + hybrid Pass 3 order.
   */
  goalWindowPlacement: z.enum(["linear", "stacked"]).optional(),
  /**
   * Only when hybrid **and** this goal is **linear-role**: whether greedy placement here
   * removes time from everyone’s stacked timemap ribbons (`blocking`) or leaves ribbons
   * computed from pre-linear gaps (`non_blocking`). Omit ⇒ `non_blocking`.
   * Ignored when global mode is `linear` / `stacked`, or when this goal is stacked-role.
   *
   * @see [`ALLOCATOR_BUSINESS_RULES.md`](../../planner/ALLOCATOR_BUSINESS_RULES.md)
   */
  stackedRibbonVsLinearPeers: z.enum(["non_blocking", "blocking"]).optional()
});
export type WeeklyGoal = z.infer<typeof weeklyGoalSchema>;

/** `UserSettings.allocator.goalWindowMode` — exported for planner/UI without importing full settings. */
export type AllocatorGoalWindowMode = "linear" | "stacked" | "hybrid";

/**
 * Effective per-goal Pass 3 placement class. When global mode is `hybrid`, uses
 * {@link WeeklyGoal.goalWindowPlacement} (omit ⇒ `stacked`).
 */
export function effectiveWeeklyGoalWindowPlacement(
  goal: Pick<WeeklyGoal, "goalWindowPlacement">,
  allocatorGoalWindowMode: AllocatorGoalWindowMode
): "linear" | "stacked" {
  // Runtime hardening: only "hybrid" should consult per-goal placement.
  // Callers sometimes pass through a shallow-merged settings object where this
  // field is missing; treat missing/unknown as schema default "linear".
  if (allocatorGoalWindowMode === "stacked") return "stacked";
  if (allocatorGoalWindowMode === "hybrid") return goal.goalWindowPlacement ?? "stacked";
  return "linear";
}

/**
 * Hybrid + linear-role only: true when this greedy row should shrink stacked timemap ribbons
 * after it runs (`blocking`). Otherwise false (ignored).
 */
export function hybridLinearPlacementBlocksTimemaps(
  goal: Pick<WeeklyGoal, "goalWindowPlacement" | "stackedRibbonVsLinearPeers">,
  allocatorGoalWindowMode: AllocatorGoalWindowMode
): boolean {
  if (allocatorGoalWindowMode !== "hybrid") return false;
  if (effectiveWeeklyGoalWindowPlacement(goal, allocatorGoalWindowMode) !== "linear") {
    return false;
  }
  return (goal.stackedRibbonVsLinearPeers ?? "non_blocking") === "blocking";
}

/** Hybrid weeks: true if any linear-role row chose to block stacked timemap ribbons (`blocking`). */
export function hybridAnyLinearGoalBlocksTimemaps(
  goals: readonly WeeklyGoal[],
  allocatorGoalWindowMode: AllocatorGoalWindowMode
): boolean {
  if (allocatorGoalWindowMode !== "hybrid") return false;
  return goals.some((g) => hybridLinearPlacementBlocksTimemaps(g, allocatorGoalWindowMode));
}

/** Hybrid: both a linear row that blocks timemaps and one that does not — UI may split proposed z-order. */
export function hybridHasMixedLinearTimemapBlocking(
  goals: readonly WeeklyGoal[],
  allocatorGoalWindowMode: AllocatorGoalWindowMode
): boolean {
  if (allocatorGoalWindowMode !== "hybrid") return false;
  let hasBlockingLinear = false;
  let hasNonBlockingLinear = false;
  for (const g of goals) {
    if (effectiveWeeklyGoalWindowPlacement(g, allocatorGoalWindowMode) !== "linear") continue;
    if (hybridLinearPlacementBlocksTimemaps(g, allocatorGoalWindowMode)) hasBlockingLinear = true;
    else hasNonBlockingLinear = true;
    if (hasBlockingLinear && hasNonBlockingLinear) return true;
  }
  return false;
}

export function normalisePlacementIdealClockBoundary(
  b: { hour: unknown; minute: unknown } | undefined
): PlacementIdealClockBoundary | undefined {
  if (!b) return undefined;
  const hour = Math.max(0, Math.min(23, Math.round(Number(b.hour))));
  const minute = Math.max(0, Math.min(59, Math.round(Number(b.minute))));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return undefined;
  return { hour, minute };
}

export function normalisePlacementIdealClockFilter(
  f: PlacementIdealClockFilter | undefined
): PlacementIdealClockFilter | undefined {
  if (!f) return undefined;
  if (f.kind !== "after" && f.kind !== "before") return undefined;
  const hour = Math.max(0, Math.min(23, Math.round(f.hour)));
  const minute = Math.max(0, Math.min(59, Math.round(f.minute)));
  return { kind: f.kind, hour, minute };
}

/** Effective “at or after” boundary, including legacy {@link PlacementIdealClockFilter}. */
export function effectivePlacementIdealAfterBoundary(goal: {
  placementIdealClockAfter?: PlacementIdealClockBoundary | undefined;
  placementIdealClockFilter?: PlacementIdealClockFilter | undefined;
}): PlacementIdealClockBoundary | undefined {
  const direct = normalisePlacementIdealClockBoundary(goal.placementIdealClockAfter);
  if (direct) return direct;
  const legacy = normalisePlacementIdealClockFilter(goal.placementIdealClockFilter);
  if (legacy?.kind === "after") return { hour: legacy.hour, minute: legacy.minute };
  return undefined;
}

/** Effective “strictly before” boundary, including legacy {@link PlacementIdealClockFilter}. */
export function effectivePlacementIdealBeforeBoundary(goal: {
  placementIdealClockBefore?: PlacementIdealClockBoundary | undefined;
  placementIdealClockFilter?: PlacementIdealClockFilter | undefined;
}): PlacementIdealClockBoundary | undefined {
  const direct = normalisePlacementIdealClockBoundary(goal.placementIdealClockBefore);
  if (direct) return direct;
  const legacy = normalisePlacementIdealClockFilter(goal.placementIdealClockFilter);
  if (legacy?.kind === "before") return { hour: legacy.hour, minute: legacy.minute };
  return undefined;
}

/**
 * Scheduling knobs shared by [`WeeklyGoal`] and [`GoalGroup`]. Validator matches
 * the corresponding fields on `weeklyGoalSchema` exactly (picked, all optional).
 *
 * Aggregate semantics (`GoalGroup`): Pass 3 uses `maxMinutesPerDay` /
 * `minMinutesPerDay` vs **sum** of member goals on each day; weekly limits use
 * **sum** of member weekly targets vs `allocationSharePercent` (× full-week `T`),
 * `maxMinutesPerWeek`, etc. Ignore at group level: energy, frameworks, anchors.
 */
export const weeklyGoalSchedulingConstraintsSchema = weeklyGoalSchema.pick({
  targetMinutes: true,
  minMinutesPerWeek: true,
  maxMinutesPerWeek: true,
  minMinutesPerDay: true,
  maxMinutesPerDay: true,
  minMinutesPerBlock: true,
  maxAutoBlocksPerDay: true,
  frequencyPerWeek: true,
  dayOfWeek: true,
  daysOfWeek: true,
  earliestHour: true,
  latestHour: true,
  placementIdealClockTimes: true,
  placementIdealClockFilter: true,
  placementIdealClockAfter: true,
  placementIdealClockBefore: true,
  allocationSharePercent: true,
  scheduleInNiceWeather: true
});
export type WeeklyGoalSchedulingConstraints = z.infer<
  typeof weeklyGoalSchedulingConstraintsSchema
>;

/** User-defined cohort on the blueprint with aggregate scheduling limits. */
export const goalGroupSchema = weeklyGoalSchedulingConstraintsSchema.extend({
  id: z.string().min(1),
  title: z.string().min(1)
});
export type GoalGroup = z.infer<typeof goalGroupSchema>;

/**
 * Stable stub for [`normaliseGoalTime`] — same inference as goals; never placed.
 */
export function stubWeeklyGoalFromGoalGroup(group: GoalGroup): WeeklyGoal {
  const { id, title, ...constraints } = group;
  return weeklyGoalSchema.parse({
    id,
    title,
    ...constraints,
    energyMode: "neutral",
    energyPolarity: "neutral",
    attentionMode: "unspecified",
    workLayer: "unspecified",
    ppfHorizon: "unspecified",
    commitmentLevel: "committed"
  });
}

function inferChargeFromTags(goal: WeeklyGoal): number {
  let c = 0.2;
  if (goal.attentionMode === "hyperfocus") c += 0.45;
  if (goal.energyMode === "hyperfocus") c += 0.25;
  if (goal.energyPolarity === "energise") c += 0.2;
  if (goal.workLayer === "needle-mover") c += 0.1;
  return Math.min(1, c);
}

function inferDrainFromTags(goal: WeeklyGoal): number {
  let d = 0.2;
  if (goal.attentionMode === "hyperaware") d += 0.45;
  if (goal.energyMode === "hyperaware") d += 0.25;
  if (goal.energyPolarity === "drain") d += 0.25;
  if (goal.workLayer === "ops") d += 0.1;
  return Math.min(1, d);
}

/**
 * Resolved charge/drain profile for battery-style scheduling (0–1 each).
 */
export function effectiveEnergyBatteryProfile(goal: WeeklyGoal): { charge: number; drain: number } {
  if (goal.energyChargeImpact !== undefined || goal.energyDrainImpact !== undefined) {
    return {
      charge: goal.energyChargeImpact ?? inferChargeFromTags(goal),
      drain: goal.energyDrainImpact ?? inferDrainFromTags(goal)
    };
  }
  if (goal.focusAffinity === "hyperfocus") {
    return { charge: 0.75, drain: 0.15 };
  }
  if (goal.focusAffinity === "hyperaware") {
    return { charge: 0.15, drain: 0.75 };
  }
  if (goal.focusAffinity === "mixed") {
    return { charge: 0.45, drain: 0.45 };
  }
  return {
    charge: inferChargeFromTags(goal),
    drain: inferDrainFromTags(goal)
  };
}

/** Calendar invert-free-busy rows: time-map readout, not a scheduling commitment. */
export function isInvertedTimemapGoal(goal: Pick<WeeklyGoal, "specialGoalType">): boolean {
  return goal.specialGoalType === "inverted-timemap";
}

/** Goals the user edits in planning tools (excludes synthetic calendar time-map rows). */
export function filterSchedulingGoals<T extends Pick<WeeklyGoal, "specialGoalType">>(
  goals: readonly T[]
): T[] {
  return goals.filter((g) => !isInvertedTimemapGoal(g));
}

/**
 * Resolved time bounds for a goal after normalising legacy `targetMinutes`
 * and per-day ↔ per-week derivations. The allocator consumes this shape
 * rather than the raw schema fields so the multi-pass distribution can stay
 * agnostic of which units the user picked.
 */
export interface NormalisedGoalTime {
  /** Floor in minutes per week, or undefined when no floor was set. */
  minMinutesPerWeek?: number;
  /** Ceiling in minutes per week, or undefined when no ceiling was set. */
  maxMinutesPerWeek?: number;
  /** Daily floor in minutes, or undefined when no per-day floor was set. */
  minMinutesPerDay?: number;
  /** Daily cap in minutes, or undefined when no per-day cap was set. */
  maxMinutesPerDay?: number;
  /** Number of days the goal should occupy across the week, when specified. */
  frequencyPerWeek?: number;
  /** True when the goal carries no time fields, no share %, and should equal-share. */
  isEqualShare: boolean;
  /** True when only legacy `targetMinutes` is set (no explicit min/max/day range). */
  isLegacyTarget: boolean;
}

/**
 * Normalises a goal's mixed time fields into a single canonical shape.
 *
 * Rules:
 *   1. If only `targetMinutes` is set (legacy / simple picker), it does **not**
 *      set weekly min or max — the goal **equal-shares** the post-floor remainder
 *      like an unconstrained row. `targetMinutes` stays on the goal for UX hints
 *      only; use explicit `minMinutesPerWeek` / `maxMinutesPerWeek` when the user
 *      needs an exact weekly band.
 *   2. If `minMinutesPerDay` is set without `minMinutesPerWeek`, derive
 *      `min/wk = min/day × scheduledDays`. When cadence is not explicit
 *      (`frequencyPerWeek`, `dayOfWeek`, `daysOfWeek`), assume **7 days** so the
 *      stated daily floor participates in weekly Pass 1 + proportional starvation
 *      like other commitments. Likewise, when `maxMinutesPerDay` is set without
 *      `maxMinutesPerWeek`, derive `max/wk = max/day × scheduledDays` using the
 *      same inferred day count (**7** when cadence is unconstrained).
 *   3. A goal with no explicit weekly/day bounds (`minMinutesPerWeek`, etc.) is
 *      "equal share", **including** when only legacy `targetMinutes` is set.
 */
export function normaliseGoalTime(goal: WeeklyGoal): NormalisedGoalTime {
  const hasAnyRange =
    goal.minMinutesPerWeek !== undefined ||
    goal.maxMinutesPerWeek !== undefined ||
    goal.minMinutesPerDay !== undefined ||
    goal.maxMinutesPerDay !== undefined;
  const hasLegacyTarget = goal.targetMinutes !== undefined;
  const constrainedDaysFromWeekdays =
    goal.daysOfWeek && goal.daysOfWeek.length > 0
      ? goal.daysOfWeek.length
      : goal.dayOfWeek
        ? 1
        : undefined;
  const inferredScheduledDays =
    goal.frequencyPerWeek !== undefined && constrainedDaysFromWeekdays !== undefined
      ? Math.min(goal.frequencyPerWeek, constrainedDaysFromWeekdays)
      : goal.frequencyPerWeek ?? constrainedDaysFromWeekdays;

  let minMinutesPerWeek = goal.minMinutesPerWeek;
  let maxMinutesPerWeek = goal.maxMinutesPerWeek;

  if (minMinutesPerWeek === undefined && goal.minMinutesPerDay !== undefined) {
    const daysForWeeklyMin = inferredScheduledDays ?? 7;
    minMinutesPerWeek = goal.minMinutesPerDay * daysForWeeklyMin;
  }
  if (maxMinutesPerWeek === undefined && goal.maxMinutesPerDay !== undefined) {
    const daysForWeeklyMax = inferredScheduledDays ?? 7;
    maxMinutesPerWeek = goal.maxMinutesPerDay * daysForWeeklyMax;
  }

  const isEqualShare =
    !hasAnyRange &&
    goal.frequencyPerWeek === undefined &&
    goal.allocationSharePercent === undefined;

  const result: NormalisedGoalTime = {
    isEqualShare,
    isLegacyTarget: !hasAnyRange && hasLegacyTarget
  };
  if (minMinutesPerWeek !== undefined) result.minMinutesPerWeek = minMinutesPerWeek;
  if (maxMinutesPerWeek !== undefined) result.maxMinutesPerWeek = maxMinutesPerWeek;
  if (goal.minMinutesPerDay !== undefined) result.minMinutesPerDay = goal.minMinutesPerDay;
  if (goal.maxMinutesPerDay !== undefined) result.maxMinutesPerDay = goal.maxMinutesPerDay;
  if (goal.frequencyPerWeek !== undefined) result.frequencyPerWeek = goal.frequencyPerWeek;
  return result;
}

/**
 * User-supplied overrides for system-generated blocks (sleep + routines) and
 * weekly allocated goal blocks (drag-to-move on the calendar).
 *
 * Stored on the WeeklyPlan rather than on UserSettings so a fresh week
 * starts clean. Keys identify the original computed block:
 *   - kind="sleep"    → key is the night index "0".."6", or "7" for the sleep
 *                       that wakes on the week's first Monday (Sun night → Mon)
 *   - kind="routine"  → key is "morning-${idx}" or "shutdown-${idx}"
 *   - kind="goal"     → key is `goal:<weekAnchorIso>:<slotIndex>:<goalId>`
 *                       (constructed by the planner).
 *
 * `source` distinguishes a UI drag ("drag") from a recorded actual time
 * captured externally ("actual"). Both are honoured the same way by the
 * planner today; the distinction is preserved so future syncback can
 * surface user edits versus measurements.
 */
export const blockOverrideSchema = z.object({
  kind: z.enum(["sleep", "routine", "goal"]),
  key: z.string().min(1),
  startMs: z.number().int(),
  endMs: z.number().int(),
  source: z.enum(["drag", "actual"]).default("drag"),
  setAt: z.number().int()
});
export type BlockOverride = z.infer<typeof blockOverrideSchema>;

/**
 * Brendan Burchard–inspired weekly intention prompts, captured at the top of
 * the planning hub. Each field is optional plain text so users can answer the
 * prompts that matter to them and skip the rest. Persisted with the rest of
 * the WeeklyPlan so a fresh week starts blank (or "carry-forward" later).
 */
export const weeklyIntentSchema = z.object({
  /** "What are the 1-3 outcomes that would make this week a win?" */
  mainOutcomes: z.string().max(2000).optional(),
  /** "What are the must-wins versus stretch goals?" */
  mustWins: z.string().max(2000).optional(),
  /** "Who do you want to show up for this week?" */
  people: z.string().max(2000).optional(),
  /** "Which of the six habits are you doubling down on?" — multi-select hint. */
  hp6Focus: z.array(hp6HabitKey).max(6).default([]),
  /** "How will you protect or generate energy?" */
  energyNote: z.string().max(2000).optional(),
  /** "What standard or mindset are you holding yourself to?" */
  mindsetNote: z.string().max(2000).optional()
});
export type WeeklyIntent = z.infer<typeof weeklyIntentSchema>;

/** Soft-deleted goal kept for restore; auto-purged after `deletedAtMs` + retention window. */
export const trashedGoalEntrySchema = z.object({
  goal: weeklyGoalSchema,
  deletedAtMs: z.number().int()
});
export type TrashedGoalEntry = z.infer<typeof trashedGoalEntrySchema>;

export const weeklyPlanSchema = z.object({
  id: z.string().min(1),
  /** Monday 00:00 in user TZ. ISO date (YYYY-MM-DD). */
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string(),
  goals: z.array(weeklyGoalSchema).default([]),
  /** Goals in the trash (same ids as before delete; restores reconnect day-sheet slots). */
  deletedGoals: z.array(trashedGoalEntrySchema).default([]),
  /**
   * Named cohorts ("Work", "Screen time") with aggregate limits; members use
   * `WeeklyGoal.groupIds`. Authoring lives on the Planner hub.
   */
  goalGroups: z.array(goalGroupSchema).default([]),
  /** User-supplied drag overrides for sleep, routine, and goal blocks. */
  overrides: z.array(blockOverrideSchema).default([]),
  /** Weekly intention prompts (Burchard-style). Optional; blank for new weeks. */
  weeklyIntent: weeklyIntentSchema.default({} as never)
});
export type WeeklyPlan = z.infer<typeof weeklyPlanSchema>;

const GOAL_SCHEDULING_KEYS = Object.keys(
  weeklyGoalSchedulingConstraintsSchema.shape
) as (keyof WeeklyGoalSchedulingConstraints)[];

export type WeeklyPlanningConstraintKey =
  keyof z.infer<typeof weeklyGoalSchedulingConstraintsSchema>;

/** Keys mirrored on goals and goal groups — for UI/tests to stay aligned. */
export const WEEKLY_GOAL_SCHEDULING_CONSTRAINT_KEYS: readonly WeeklyPlanningConstraintKey[] =
  GOAL_SCHEDULING_KEYS as WeeklyPlanningConstraintKey[];

/**
 * Drops `groupIds` entries that don't match a `GoalGroup.id` on `plan`.
 */
export function sanitizeWeeklyPlanGoalGroupRefs(plan: WeeklyPlan): WeeklyPlan {
  const valid = new Set((plan.goalGroups ?? []).map((g) => g.id));
  const goals =
    plan.goals?.map((g) =>
      !g.groupIds?.length
        ? g
        : {
            ...g,
            groupIds: g.groupIds.filter((id) => valid.has(id))
          }
    ) ?? [];
  const deletedGoals =
    plan.deletedGoals?.map((entry) =>
      !entry.goal.groupIds?.length
        ? entry
        : {
            ...entry,
            goal: {
              ...entry.goal,
              groupIds: entry.goal.groupIds.filter((id) => valid.has(id))
            }
          }
    ) ?? [];
  return weeklyPlanSchema.parse({ ...plan, goals, deletedGoals });
}
