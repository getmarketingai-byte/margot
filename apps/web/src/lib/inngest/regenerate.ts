/**
 * Inngest function: regenerate a user's CalendarSnapshot.
 *
 * The function is idempotent and short-lived per `step` invocation, so it fits
 * inside Vercel's serverless duration limits. Long work is split into discrete
 * step.run blocks so retries pick up at the failed step instead of restarting.
 */

import { allocateWeek, buildStableUid, type AllocatedBlock } from "@calendar-automations/planner";
import type { GeneratedEvent, WeeklyPlan } from "@calendar-automations/schema";
import { eq } from "drizzle-orm";
import { inngest } from "./client";
import { db, schema } from "../db/index";
import { loadSettings } from "../settings-store";
import { fetchGoogleBusy } from "../google-calendar";
import { saveSnapshot } from "../snapshots";

export const regenerateSnapshot = inngest.createFunction(
  { id: "regenerate-snapshot", retries: 2, concurrency: { limit: 1, key: "event.data.userId" } },
  { event: "user/regenerate.requested" },
  async ({ event, step }) => {
    const { userId } = event.data;

    const settings = await step.run("load-settings", () => loadSettings(userId));

    const window = await step.run("compute-window", () => {
      const now = Date.now();
      const days = settings.calendars.schedulingWindowDays;
      return { startMs: now, endMs: now + days * 24 * 60 * 60 * 1000 };
    });

    const busy = await step.run("fetch-busy", () =>
      fetchGoogleBusy(userId, settings.calendars.sources, window.startMs, window.endMs)
    );

    const plan = await step.run("load-current-plan", async (): Promise<WeeklyPlan | null> => {
      if (!db) return null;
      const rows = await db
        .select()
        .from(schema.weeklyPlans)
        .where(eq(schema.weeklyPlans.userId, userId))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return row.data as WeeklyPlan;
    });

    const events = await step.run("generate-events", () => {
      if (!plan) return [] as GeneratedEvent[];
      const result = allocateWeek({ plan, busy, settings });
      return result.blocks.map((b) => toGeneratedEvent(userId, plan, b));
    });

    await step.run("persist-snapshot", () =>
      saveSnapshot(userId, {
        generatedAt: Date.now(),
        windowStartMs: window.startMs,
        windowEndMs: window.endMs,
        events
      })
    );

    await step.sendEvent("notify-completion", {
      name: "user/snapshot.completed",
      data: { userId }
    });

    return { eventCount: events.length };
  }
);

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
