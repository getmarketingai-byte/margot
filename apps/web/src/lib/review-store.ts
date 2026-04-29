/**
 * Server-side load/save helpers for daily + weekly reviews.
 *
 * Mirrors the singleton-jsonb pattern used by `weekly_plan`: each row stores
 * the full payload as `data`, and the surrounding columns (`date`,
 * `weekStart`, `timezone`) exist only as indexed lookup keys.
 */

import "server-only";

import { and, eq, gte, lte } from "drizzle-orm";
import {
  type DailyReview,
  type WeeklyReview,
  dailyReviewSchema,
  weeklyReviewSchema
} from "@calendar-automations/schema";
import { db, schema } from "./db/index";
import { partsInTimezone } from "./week";

const DAY_MS = 24 * 60 * 60 * 1000;

function emptyDailyReview(date: string, timezone: string): DailyReview {
  return dailyReviewSchema.parse({ date, timezone });
}

function emptyWeeklyReview(weekStart: string, timezone: string): WeeklyReview {
  return weeklyReviewSchema.parse({ weekStart, timezone });
}

export async function loadDailyReview(
  userId: string,
  date: string,
  timezone: string
): Promise<DailyReview> {
  if (!db) return emptyDailyReview(date, timezone);
  const rows = await db
    .select()
    .from(schema.dailyReviews)
    .where(and(eq(schema.dailyReviews.userId, userId), eq(schema.dailyReviews.date, date)))
    .limit(1);
  const row = rows[0];
  if (!row) return emptyDailyReview(date, timezone);
  // Re-parse defensively so old rows missing newer fields hydrate cleanly.
  return dailyReviewSchema.parse({ ...(row.data as object), date, timezone });
}

export async function saveDailyReview(
  userId: string,
  review: DailyReview
): Promise<void> {
  if (!db) return;
  const parsed = dailyReviewSchema.parse(review);
  const existing = await db
    .select()
    .from(schema.dailyReviews)
    .where(
      and(
        eq(schema.dailyReviews.userId, userId),
        eq(schema.dailyReviews.date, parsed.date)
      )
    )
    .limit(1);
  if (existing[0]) {
    await db
      .update(schema.dailyReviews)
      .set({
        data: parsed,
        timezone: parsed.timezone,
        updatedAt: new Date()
      })
      .where(eq(schema.dailyReviews.id, existing[0].id));
  } else {
    await db.insert(schema.dailyReviews).values({
      userId,
      date: parsed.date,
      timezone: parsed.timezone,
      data: parsed
    });
  }
}

export async function loadDailyReviewsInRange(
  userId: string,
  startDate: string,
  endDate: string
): Promise<DailyReview[]> {
  if (!db) return [];
  const rows = await db
    .select()
    .from(schema.dailyReviews)
    .where(
      and(
        eq(schema.dailyReviews.userId, userId),
        gte(schema.dailyReviews.date, startDate),
        lte(schema.dailyReviews.date, endDate)
      )
    );
  return rows.map((r) =>
    dailyReviewSchema.parse({ ...(r.data as object), date: r.date, timezone: r.timezone })
  );
}

export async function loadWeeklyReview(
  userId: string,
  weekStart: string,
  timezone: string
): Promise<WeeklyReview> {
  if (!db) return emptyWeeklyReview(weekStart, timezone);
  const rows = await db
    .select()
    .from(schema.weeklyReviews)
    .where(
      and(
        eq(schema.weeklyReviews.userId, userId),
        eq(schema.weeklyReviews.weekStart, weekStart)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return emptyWeeklyReview(weekStart, timezone);
  return weeklyReviewSchema.parse({
    ...(row.data as object),
    weekStart,
    timezone
  });
}

export async function saveWeeklyReview(
  userId: string,
  review: WeeklyReview
): Promise<void> {
  if (!db) return;
  const parsed = weeklyReviewSchema.parse(review);
  const existing = await db
    .select()
    .from(schema.weeklyReviews)
    .where(
      and(
        eq(schema.weeklyReviews.userId, userId),
        eq(schema.weeklyReviews.weekStart, parsed.weekStart)
      )
    )
    .limit(1);
  if (existing[0]) {
    await db
      .update(schema.weeklyReviews)
      .set({
        data: parsed,
        timezone: parsed.timezone,
        updatedAt: new Date()
      })
      .where(eq(schema.weeklyReviews.id, existing[0].id));
  } else {
    await db.insert(schema.weeklyReviews).values({
      userId,
      weekStart: parsed.weekStart,
      timezone: parsed.timezone,
      data: parsed
    });
  }
}

/* ─────────────────────────── Date-key helpers ────────────────────────────── */

/** "YYYY-MM-DD" form of `ms` interpreted in `timezone`. */
export function isoDateInTz(ms: number, timezone: string): string {
  const parts = partsInTimezone(ms, timezone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

/** Today (in the user's TZ) as an ISO date. */
export function todayIsoInTz(timezone: string, reference = new Date()): string {
  return isoDateInTz(reference.getTime(), timezone);
}

/**
 * Inclusive list of "YYYY-MM-DD" date keys for the seven days starting at
 * `weekStartMs` in the user's TZ. Useful for fanning out per-day fetches.
 */
export function isoDatesForWeek(weekStartMs: number, timezone: string): string[] {
  const out: string[] = [];
  for (let d = 0; d < 7; d++) {
    out.push(isoDateInTz(weekStartMs + d * DAY_MS, timezone));
  }
  return out;
}
