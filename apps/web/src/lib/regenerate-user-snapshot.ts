/**
 * Synchronous snapshot regeneration for a user — shared by Inngest jobs and
 * the public ICS feed (calendar clients polling the feed URL).
 */

import { allocateWeek, buildStableUid, type AllocatedBlock } from "@calendar-automations/planner";
import type { GeneratedEvent, WeeklyPlan } from "@calendar-automations/schema";
import { eq } from "drizzle-orm";
import { db, schema } from "./db/index";
import { fetchGoogleBusy } from "./google-calendar";
import { filterInvertedTimemapFromProposedBlocks } from "./proposed-calendar-filter";
import { loadSettings } from "./settings-store";
import { saveSnapshot } from "./snapshots";
import { outsideNiceWeatherIntervalsInRange } from "./nice-weather-intervals";
import { buildWeatherTimemapEvents } from "./weather-timemap";
import { buildSystemBlocks, overridesFromPlan } from "./system-blocks-server";
import { isoCalendarDay, localMondayMidnightMs } from "./week";
import { gymGoalTravelBlocksFromProposed, type SystemBlock } from "./week-blocks";

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

function systemBlockKind(block: SystemBlock): GeneratedEvent["kind"] {
  switch (block.system) {
    case "sleep":
      return "sleep";
    case "travel":
      return "travel";
    case "routine":
      return "routine";
    case "weather":
      return "timemap";
  }
}

function toGeneratedSystemEvent(userId: string, block: SystemBlock): GeneratedEvent {
  const tags = ["system", block.system];
  if (block.variant) tags.push(block.variant);
  if (block.override?.isOverridden) tags.push("overridden");
  return {
    uid: buildStableUid([userId, "system", block.system, block.sourceId, block.startMs, block.endMs]),
    kind: systemBlockKind(block),
    title: block.title,
    startMs: block.startMs,
    endMs: block.endMs,
    busy: block.busy,
    ...(block.location ? { location: block.location } : {}),
    tags
  };
}

export async function runRegenerateForUser(userId: string): Promise<{ eventCount: number }> {
  if (!db) return { eventCount: 0 };

  const settings = await loadSettings(userId);
  const now = Date.now();
  const days = settings.calendars.schedulingWindowDays;
  const window = { startMs: now, endMs: now + days * 24 * 60 * 60 * 1000 };
  const weekStartMs = localMondayMidnightMs(settings.timezone);
  const weekEndMs = weekStartMs + 7 * 24 * 60 * 60 * 1000;

  const busyFetch = await fetchGoogleBusy(
    userId,
    settings.calendars.sources,
    weekStartMs,
    weekEndMs
  );
  const busy = busyFetch.busyEvents.filter((e) => e.endMs > weekStartMs && e.startMs < weekEndMs);

  const planRows = await db
    .select()
    .from(schema.weeklyPlans)
    .where(eq(schema.weeklyPlans.userId, userId))
    .limit(1);
  const planRow = planRows[0];
  const plan = planRow ? (planRow.data as WeeklyPlan) : null;
  const systemBlocks = await buildSystemBlocks({
    userId,
    settings,
    weekStartMs,
    busy,
    overrides: overridesFromPlan(plan ?? undefined),
    nowMs: now
  });
  const sleepBlockMs = systemBlocks
    .filter((b) => b.system === "sleep")
    .map((b) => ({ startMs: b.startMs, endMs: b.endMs }));
  const weatherTimemapEvents = await buildWeatherTimemapEvents({
    userId,
    windowStartMs: window.startMs,
    windowEndMs: window.endMs,
    weather: settings.weather,
    homeAddress: settings.travel.homeAddress,
    geocodes: settings.travelCache?.geocodes,
    stableUid: buildStableUid,
    sleepBlockMs
  });
  const niceWeatherWindows = outsideNiceWeatherIntervalsInRange(
    weatherTimemapEvents,
    weekStartMs,
    weekEndMs
  );
  const proposedBlocks =
    plan != null
      ? filterInvertedTimemapFromProposedBlocks(
          allocateWeek({
            plan,
            busy: [...busy, ...systemBlocks],
            goalAvailabilityWindows: busyFetch.goalAvailabilityWindows,
            niceWeatherWindows,
            settings,
            weekStartMs,
            weekEndMs,
            weekAnchorDate: isoCalendarDay(weekStartMs, settings.timezone)
          }).blocks,
          plan,
          settings.calendars.sources
        )
      : [];
  const events = plan ? proposedBlocks.map((b) => toGeneratedEvent(userId, plan, b)) : [];
  const gymTravelBlocks = plan
    ? gymGoalTravelBlocksFromProposed(proposedBlocks, plan.goals, settings.travel, settings.gym)
    : [];
  const systemEvents = [
    ...systemBlocks.map((b) => toGeneratedSystemEvent(userId, b)),
    ...gymTravelBlocks.map((b) => toGeneratedSystemEvent(userId, b))
  ];

  const mergedEvents = [...events, ...systemEvents, ...weatherTimemapEvents].sort(
    (a, b) => a.startMs - b.startMs
  );

  await saveSnapshot(userId, {
    generatedAt: Date.now(),
    windowStartMs: window.startMs,
    windowEndMs: window.endMs,
    events: mergedEvents
  });

  return { eventCount: mergedEvents.length };
}
