/**
 * Daily + weekly review schema.
 *
 * Captures Dan Martell-style 15-minute time logs with energy state, plus
 * Brendon Burchard HPP morning intentions and evening scorecard prompts.
 * One DailyReview per (user, date), one WeeklyReview per (user, weekStart).
 *
 * Both shapes are stored as opaque jsonb in their respective tables so we can
 * iterate on prompts without churning SQL migrations.
 */

import { z } from "zod";
import { hp6HabitKey } from "./settings";

/* ─────────────────────────── Shared primitives ───────────────────────────── */

/**
 * Manual energy-state classification of a single 15-minute slot. Mirrors the
 * `energyPolarity` enum on goals so the daily log and the energy board speak
 * the same vocabulary.
 */
export const energyState = z.enum(["energise", "neutral", "drain"]);
export type EnergyState = z.infer<typeof energyState>;

/* ───────────────────────── Daily review payload ──────────────────────────── */

/**
 * Snapshot of an allocator-produced block, frozen into the daily review the
 * first time the page is opened. Keeping a copy here means block marks survive
 * later re-allocations whose output may differ as inputs (busy, overrides) drift.
 */
export const allocatedBlockSnapshotSchema = z.object({
  goalId: z.string().min(1),
  title: z.string().min(1),
  startMs: z.number().int(),
  endMs: z.number().int()
});
export type AllocatedBlockSnapshot = z.infer<typeof allocatedBlockSnapshotSchema>;

/**
 * One 15-minute (or longer, in 15m multiples) slot of a daily time log. The
 * slot's `goalId` ties actuals back to a weekly goal; `category` distinguishes
 * goal-aligned work from system blocks (sleep/routine), unplanned-but-useful
 * time, and interruptions.
 *
 * Times are minutes-from-midnight in the user's local timezone. The end of
 * the day is represented as 1440; we cap the start at 1425 so any zero-length
 * slot is rejected by the schema.
 */
export const logSlotSchema = z
  .object({
    startMinute: z.number().int().min(0).max(1425),
    endMinute: z.number().int().min(15).max(1440),
    goalId: z.string().optional(),
    category: z
      .enum(["goal", "system", "unplanned", "interruption"])
      .default("goal"),
    energy: energyState.default("neutral"),
    note: z.string().max(280).optional()
  })
  .refine((slot) => slot.endMinute > slot.startMinute, {
    message: "endMinute must be greater than startMinute",
    path: ["endMinute"]
  });
export type LogSlot = z.infer<typeof logSlotSchema>;

/**
 * Per-block completion mark. Keyed by `${goalId}:${startMs}` from
 * `plannedBlocksSnapshot` so it survives re-allocations.
 */
export const blockMarkSchema = z.object({
  blockKey: z.string().min(1),
  status: z.enum(["done", "partial", "skipped"]),
  actualMinutes: z.number().int().nonnegative().optional(),
  note: z.string().optional()
});
export type BlockMark = z.infer<typeof blockMarkSchema>;

/**
 * Per-goal completion mark on a given day. Independent of block marks so the
 * user can express "made progress overall" even when individual blocks didn't
 * map cleanly.
 */
export const goalMarkSchema = z.object({
  goalId: z.string().min(1),
  status: z.enum(["done", "partial", "skipped", "in-progress"]),
  actualMinutes: z.number().int().nonnegative().optional(),
  note: z.string().optional()
});
export type GoalMark = z.infer<typeof goalMarkSchema>;

/** Brendon Burchard HPP morning intentions block. */
export const morningPromptSchema = z
  .object({
    intentions: z.array(z.string().max(280)).max(5).default([]),
    gratitude: z.array(z.string().max(280)).max(3).default([]),
    todaysFocus: z.string().max(280).optional(),
    hp6Focus: hp6HabitKey.optional()
  })
  .default({ intentions: [], gratitude: [] });
export type MorningPrompt = z.infer<typeof morningPromptSchema>;

/** Brendon Burchard HPP evening scorecard block. */
export const eveningScorecardSchema = z
  .object({
    wins: z.array(z.string().max(280)).max(5).default([]),
    improvements: z.array(z.string().max(280)).max(5).default([]),
    tomorrow: z.string().max(280).optional(),
    /** 1-10 self-rating per HP6 habit. Sparse: only filled habits are stored. */
    hp6Score: z.record(hp6HabitKey, z.number().int().min(1).max(10)).default({})
  })
  .default({ wins: [], improvements: [], hp6Score: {} });
export type EveningScorecard = z.infer<typeof eveningScorecardSchema>;

export const dailyReviewSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string(),
  plannedBlocksSnapshot: z.array(allocatedBlockSnapshotSchema).default([]),
  morning: morningPromptSchema,
  slots: z.array(logSlotSchema).default([]),
  blockMarks: z.array(blockMarkSchema).default([]),
  goalMarks: z.array(goalMarkSchema).default([]),
  evening: eveningScorecardSchema
});
export type DailyReview = z.infer<typeof dailyReviewSchema>;

/* ──────────────────────── Weekly review payload ──────────────────────────── */

/**
 * Burchard's weekly synthesis questions. Each is optional so the user can
 * answer in any order or skip prompts that don't apply that week.
 */
export const burchardWeeklyQuestionsSchema = z
  .object({
    biggestWins: z.array(z.string().max(500)).max(10).default([]),
    lessons: z.array(z.string().max(500)).max(10).default([]),
    affectedOthers: z.string().max(1000).optional(),
    nextWeekFocus: z.string().max(1000).optional(),
    energySources: z.string().max(1000).optional(),
    energyDrains: z.string().max(1000).optional()
  })
  .default({ biggestWins: [], lessons: [] });
export type BurchardWeeklyQuestions = z.infer<typeof burchardWeeklyQuestionsSchema>;

export const weeklyReviewSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string(),
  burchardQuestions: burchardWeeklyQuestionsSchema,
  /**
   * Map of goalId -> additional minutes to add to that goal's effective
   * `minMinutesPerWeek` floor for the remainder of the current week. The
   * allocator consumes this as `catchUpFloors`. Cleared on week roll-over.
   */
  catchUpAdjustments: z.record(z.string(), z.number().int()).default({}),
  /** Epoch ms when the user last applied catch-up adjustments. */
  appliedAt: z.number().int().optional()
});
export type WeeklyReview = z.infer<typeof weeklyReviewSchema>;

/* ──────────────────────────── Block key helpers ──────────────────────────── */

/**
 * Canonical key for a planned block within a daily review. We prefix with the
 * goal so a block whose start time is shared by two goals (e.g. an exact
 * adjacency in the allocator output) still gets distinct entries.
 */
export function blockKeyFor(goalId: string, startMs: number): string {
  return `${goalId}:${startMs}`;
}
