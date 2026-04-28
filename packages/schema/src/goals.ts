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

export const weeklyGoalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  targetMinutes: z.number().int().positive(),
  /** When set, the goal must land on this day; otherwise the allocator floats it. */
  dayOfWeek: dayOfWeek.optional(),
  priority: z.number().int().min(1).max(5).default(3),
  energyMode: energyMode.default("neutral"),
  wheelAreaId: z.string().optional(),
  ppfPillar: ppfPillarKey.optional(),
  ppfHorizon: ppfHorizonKey.default("unspecified"),
  hp6Habit: hp6HabitKey.optional(),
  /** Inclusive earliest hour (0-23). */
  earliestHour: z.number().int().min(0).max(23).optional(),
  /** Exclusive latest hour (0-24). */
  latestHour: z.number().int().min(0).max(24).optional(),
  /** Free-form anchor hint, e.g. "after-work", "morning". Display-only for v1. */
  anchor: z.string().optional()
});
export type WeeklyGoal = z.infer<typeof weeklyGoalSchema>;

export const weeklyPlanSchema = z.object({
  id: z.string().min(1),
  /** Monday 00:00 in user TZ. ISO date (YYYY-MM-DD). */
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string(),
  goals: z.array(weeklyGoalSchema).default([])
});
export type WeeklyPlan = z.infer<typeof weeklyPlanSchema>;
