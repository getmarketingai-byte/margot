/**
 * Persistence helpers for `CalendarSnapshot` rows — generated event lists.
 * The latest snapshot per user is rendered into the ICS feed routes.
 */

import { desc, eq } from "drizzle-orm";
import type { CalendarSnapshot, GeneratedEvent } from "@calendar-automations/schema";
import { db, schema } from "./db/index";

export async function saveSnapshot(
  userId: string,
  snapshot: CalendarSnapshot
): Promise<void> {
  if (!db) return;
  await db.insert(schema.calendarSnapshots).values({
    userId,
    generatedAt: new Date(snapshot.generatedAt),
    windowStartMs: String(snapshot.windowStartMs),
    windowEndMs: String(snapshot.windowEndMs),
    events: snapshot.events
  });
}

export async function loadLatestSnapshot(userId: string): Promise<CalendarSnapshot | null> {
  if (!db) return null;
  const rows = await db
    .select()
    .from(schema.calendarSnapshots)
    .where(eq(schema.calendarSnapshots.userId, userId))
    .orderBy(desc(schema.calendarSnapshots.generatedAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    generatedAt: row.generatedAt.getTime(),
    windowStartMs: Number(row.windowStartMs),
    windowEndMs: Number(row.windowEndMs),
    events: row.events as GeneratedEvent[]
  };
}
