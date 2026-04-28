/**
 * Synchronous snapshot regeneration for a user — shared by Inngest jobs and
 * the public ICS feed (calendar clients polling the feed URL).
 */

import { allocateWeek, buildStableUid, type AllocatedBlock } from "@calendar-automations/planner";
import type { GeneratedEvent, WeeklyPlan } from "@calendar-automations/schema";
import { eq } from "drizzle-orm";
import { db, schema } from "./db/index";
import { fetchGoogleBusy } from "./google-calendar";
import { loadSettings } from "./settings-store";
import { saveSnapshot } from "./snapshots";

/** Minimum age of the latest snapshot before a feed request triggers Google + replan. */
export const FEED_TRIGGERED_REGENERATE_MIN_INTERVAL_MS = 3 * 60 * 1000;

function toGeneratedEvent(
  userId: string,
  plan: WeeklyPlan,
  block: AllocatedBlock
): GeneratedEvent {
  const tags: string[] = [];
  if (block.energyMode) tags.push(block.energyMode);
  if (block.ppfPillar) tags.push(block.ppfPillar);
  if (block.wheelAreaId) tags.push(`wheel:${block.wheelAreaId}`);
  if (block.hp6Habit) tags.push(`hp6:${block.hp6Habit}`);
  return {
    uid: buildStableUid([userId, plan.id, block.goalId, block.startMs]),
    kind: block.segment ? "consistency-segment" : "weekly-goal",
    title: block.title,
    startMs: block.startMs,
    endMs: block.endMs,
    busy: true,
    tags
  };
}

export async function runRegenerateForUser(userId: string): Promise<{ eventCount: number }> {
  if (!db) return { eventCount: 0 };

  const settings = await loadSettings(userId);
  const now = Date.now();
  const days = settings.calendars.schedulingWindowDays;
  const window = { startMs: now, endMs: now + days * 24 * 60 * 60 * 1000 };

  const busy = await fetchGoogleBusy(userId, settings.calendars.sources, window.startMs, window.endMs);

  const planRows = await db
    .select()
    .from(schema.weeklyPlans)
    .where(eq(schema.weeklyPlans.userId, userId))
    .limit(1);
  const planRow = planRows[0];
  const plan = planRow ? (planRow.data as WeeklyPlan) : null;

  const events =
    plan ? allocateWeek({ plan, busy, settings }).blocks.map((b) => toGeneratedEvent(userId, plan, b)) : [];

  await saveSnapshot(userId, {
    generatedAt: Date.now(),
    windowStartMs: window.startMs,
    windowEndMs: window.endMs,
    events
  });

  return { eventCount: events.length };
}
