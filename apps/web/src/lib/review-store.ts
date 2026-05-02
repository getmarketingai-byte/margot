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
  allocatedBlockSnapshotSchema,
  blockMarkSchema,
  dailyReviewSchema,
  eveningScorecardSchema,
  goalMarkSchema,
  logSlotSchema,
  morningPromptSchema,
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

/**
 * DB jsonb can contain legacy or hand-edited rows that no longer satisfy the
 * strict Zod contract (e.g. log slots with endMinute ≤ startMinute). Strip
 * invalid list items so a single bad slot does not 500 the day sheet.
 */
function hydrateDailyReviewFromRow(
  data: object,
  date: string,
  timezone: string
): DailyReview {
  const merged = { ...data, date, timezone };
  const strict = dailyReviewSchema.safeParse(merged);
  if (strict.success) return strict.data;

  const raw = data as Record<string, unknown>;
  const slotsRaw = Array.isArray(raw.slots) ? raw.slots : [];
  const slots = slotsRaw
    .map((s) => logSlotSchema.safeParse(s))
    .filter((r) => r.success)
    .map((r) => r.data);

  const snapRaw = Array.isArray(raw.plannedBlocksSnapshot) ? raw.plannedBlocksSnapshot : [];
  const plannedBlocksSnapshot = snapRaw
    .map((b) => allocatedBlockSnapshotSchema.safeParse(b))
    .filter((r) => r.success)
    .map((r) => r.data);

  const bmRaw = Array.isArray(raw.blockMarks) ? raw.blockMarks : [];
  const blockMarks = bmRaw
    .map((b) => blockMarkSchema.safeParse(b))
    .filter((r) => r.success)
    .map((r) => r.data);

  const gmRaw = Array.isArray(raw.goalMarks) ? raw.goalMarks : [];
  const goalMarks = gmRaw
    .map((g) => goalMarkSchema.safeParse(g))
    .filter((r) => r.success)
    .map((r) => r.data);

  const morning = morningPromptSchema.safeParse(raw.morning);
  const evening = eveningScorecardSchema.safeParse(raw.evening);
  const shell = emptyDailyReview(date, timezone);

  const recovered = dailyReviewSchema.safeParse({
    date,
    timezone,
    plannedBlocksSnapshot,
    morning: morning.success ? morning.data : shell.morning,
    slots,
    blockMarks,
    goalMarks,
    evening: evening.success ? evening.data : shell.evening
  });
  if (recovered.success) return recovered.data;

  console.warn("hydrateDailyReviewFromRow: could not recover row; using empty shell", {
    date
  });
  return emptyDailyReview(date, timezone);
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
  return hydrateDailyReviewFromRow(row.data as object, date, timezone);
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
  return rows.map((r) => hydrateDailyReviewFromRow(r.data as object, r.date, r.timezone));
}

/** All day-sheet rows for the user (full history). Used for trash purge and log detection. */
export async function loadAllDailyReviewsForUser(userId: string): Promise<DailyReview[]> {
  if (!db) return [];
  const rows = await db.select().from(schema.dailyReviews).where(eq(schema.dailyReviews.userId, userId));
  return rows.map((r) => hydrateDailyReviewFromRow(r.data as object, r.date, r.timezone));
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

export async function loadAllWeeklyReviewsForUser(userId: string): Promise<WeeklyReview[]> {
  if (!db) return [];
  const rows = await db.select().from(schema.weeklyReviews).where(eq(schema.weeklyReviews.userId, userId));
  return rows.map((r) =>
    weeklyReviewSchema.parse({
      ...(r.data as object),
      weekStart: r.weekStart,
      timezone: r.timezone
    })
  );
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
