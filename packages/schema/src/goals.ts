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

export const specialGoalType = z.enum([
  "morning-routine",
  "shutdown-routine",
  "gym",
  "errands",
  /** Synthetic row for invert-free-busy calendar sources (readout, not a commitment). */
  "inverted-timemap"
]);
export type SpecialGoalType = z.infer<typeof specialGoalType>;

export const weeklyGoalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  /**
   * Legacy fixed weekly target. When present and the new min/max fields are
   * absent, normalisation treats this as `min = max = targetMinutes`.
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
   * Optional semantic type used by the UI for routine presets that map to
   * existing timemap/sleep/travel patterns.
   */
  specialGoalType: specialGoalType.optional()
});
export type WeeklyGoal = z.infer<typeof weeklyGoalSchema>;

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
  /** True when the goal carries no time fields and should equal-share. */
  isEqualShare: boolean;
  /** True when the legacy `targetMinutes` field was used to derive bounds. */
  isLegacyTarget: boolean;
}

/**
 * Normalises a goal's mixed time fields into a single canonical shape.
 *
 * Rules:
 *   1. If only `targetMinutes` is set, treat it as `min == max == targetMinutes`.
 *   2. If `minMinutesPerDay` is set without `minMinutesPerWeek`, derive
 *      `min/wk = min/day × (frequencyPerWeek ?? 7)`. Same for max.
 *   3. A goal with no time fields is "equal share".
 */
export function normaliseGoalTime(goal: WeeklyGoal): NormalisedGoalTime {
  const hasAnyRange =
    goal.minMinutesPerWeek !== undefined ||
    goal.maxMinutesPerWeek !== undefined ||
    goal.minMinutesPerDay !== undefined ||
    goal.maxMinutesPerDay !== undefined;
  const hasLegacyTarget = goal.targetMinutes !== undefined;
  const days = goal.frequencyPerWeek ?? 7;

  let minMinutesPerWeek = goal.minMinutesPerWeek;
  let maxMinutesPerWeek = goal.maxMinutesPerWeek;

  if (!hasAnyRange && hasLegacyTarget) {
    minMinutesPerWeek = goal.targetMinutes;
    maxMinutesPerWeek = goal.targetMinutes;
  }

  if (minMinutesPerWeek === undefined && goal.minMinutesPerDay !== undefined) {
    minMinutesPerWeek = goal.minMinutesPerDay * days;
  }
  if (maxMinutesPerWeek === undefined && goal.maxMinutesPerDay !== undefined) {
    maxMinutesPerWeek = goal.maxMinutesPerDay * days;
  }

  const isEqualShare =
    !hasAnyRange &&
    !hasLegacyTarget &&
    goal.frequencyPerWeek === undefined;

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
 * User-supplied overrides for system-generated blocks (sleep + routines).
 *
 * Stored on the WeeklyPlan rather than on UserSettings so a fresh week
 * starts clean. Keys identify the original computed block:
 *   - kind="sleep"    → key is the night index "0".."6"
 *   - kind="routine"  → key is "morning-${idx}" or "shutdown-${idx}"
 *
 * `source` distinguishes a UI drag ("drag") from a recorded actual time
 * captured externally ("actual"). Both are honoured the same way by the
 * planner today; the distinction is preserved so future syncback can
 * surface user edits versus measurements.
 */
export const blockOverrideSchema = z.object({
  kind: z.enum(["sleep", "routine"]),
  key: z.string().min(1),
  startMs: z.number().int(),
  endMs: z.number().int(),
  source: z.enum(["drag", "actual"]).default("drag"),
  setAt: z.number().int()
});
export type BlockOverride = z.infer<typeof blockOverrideSchema>;

export const weeklyPlanSchema = z.object({
  id: z.string().min(1),
  /** Monday 00:00 in user TZ. ISO date (YYYY-MM-DD). */
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string(),
  goals: z.array(weeklyGoalSchema).default([]),
  /** User-supplied drag overrides for sleep + routine blocks. */
  overrides: z.array(blockOverrideSchema).default([])
});
export type WeeklyPlan = z.infer<typeof weeklyPlanSchema>;
