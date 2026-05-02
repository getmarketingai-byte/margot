/**
 * Synchronous snapshot regeneration for a user — shared by Inngest jobs and
 * the public ICS feed (calendar clients polling the feed URL).
 */

import {
  allocateWeek,
  buildStableUid,
  goalOverrideSourcesFromPlan,
  schedulingGoalsWithWeeklyRoutines,
  type AllocatedBlock
} from "@calendar-automations/planner";
import type { GeneratedEvent, WeeklyPlan } from "@calendar-automations/schema";
import { eq } from "drizzle-orm";
import { db, schema } from "./db/index";
import { getCachedPlanWeekAllocationInputs } from "@/lib/cached-plan-week-allocation-inputs";
import { invertedCalendarTimemapEvents } from "./inverted-timemap-ics-events";
import { loadSettings } from "./settings-store";
import { filterInvertedTimemapFromProposedBlocks } from "./proposed-calendar-filter";
import { mergeOrphanGoalOverrideBlocks } from "./merge-orphan-goal-override-blocks";
import { saveSnapshot } from "./snapshots";
import { loadBillingState } from "./billing-state-server";
import { clipIntervalBlocksToHorizon } from "./effective-schedule-horizon";
import {
  gymGoalTravelBlocksFromProposed,
  sleepIntervalsForAllocation,
  type SystemBlock
} from "./week-blocks";

/** Minimum age of the latest snapshot before a feed request triggers Google + replan. */
export const FEED_TRIGGERED_REGENERATE_MIN_INTERVAL_MS = 3 * 60 * 1000;

function coalesceAdjacentWeeklyGoalBlocksForIcs(blocks: readonly AllocatedBlock[]): AllocatedBlock[] {
  const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs);
  const out: AllocatedBlock[] = [];
  for (const b of sorted) {
    if (b.segment) {
      out.push({ ...b });
      continue;
    }
    const last = out[out.length - 1];
    if (
      last &&
      !last.segment &&
      last.goalId === b.goalId &&
      last.endMs === b.startMs
    ) {
      last.endMs = b.endMs;
    } else {
      out.push({ ...b });
    }
  }
  return out;
}

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
  tags.push(`goal:${block.goalId}`);
  const goal = plan.goals.find((g) => g.id === block.goalId);
  for (const gid of goal?.groupIds ?? []) {
    tags.push(`group:${gid}`);
  }
  if (goal?.specialGoalType) {
    tags.push(`special:${goal.specialGoalType}`);
  }
  return {
    uid: buildStableUid([userId, plan.id, block.goalId, block.startMs, block.endMs]),
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
    case "inverted-timemap":
      return "timemap";
  }
}

function toGeneratedSystemEvent(userId: string, block: SystemBlock): GeneratedEvent {
  const tags = ["system", block.system];
  if (block.variant) tags.push(block.variant);
  if (block.override?.isOverridden) tags.push("overridden");
  if (/(-gym-pre|-gym-post)$/.test(block.sourceId)) tags.push("gym-pad");
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
  const nowMs = Date.now();
  const snapshotEndMs = nowMs + settings.calendars.schedulingWindowDays * 24 * 60 * 60 * 1000;

  const planRows = await db
    .select()
    .from(schema.weeklyPlans)
    .where(eq(schema.weeklyPlans.userId, userId))
    .limit(1);
  const planRow = planRows[0];
  const plan = planRow ? (planRow.data as WeeklyPlan) : null;

  if (!plan) {
    await saveSnapshot(userId, {
      generatedAt: Date.now(),
      windowStartMs: nowMs,
      windowEndMs: snapshotEndMs,
      events: []
    });
    return { eventCount: 0 };
  }

  const billing = await loadBillingState(userId);
  const ctx = await getCachedPlanWeekAllocationInputs({
    userId,
    plan,
    settings,
    nowMs,
    billing
  });

  const mergeWindows = ctx.weekSlices.map((s) => ({
    weekStartMs: s.weekStartMs,
    weekEndMs: s.weekEndMs
  }));

  const allocationSlices = ctx.weekSlices.map((slice, idx) =>
    allocateWeek({
      plan,
      busy: [...slice.busy, ...slice.daySheetGoalBusy, ...slice.systemBlocks],
      goalAvailabilityWindows: ctx.busyFetch.goalAvailabilityWindows,
      niceWeatherWindows: slice.niceWeatherWindows,
      settings,
      weekStartMs: slice.weekStartMs,
      weekEndMs: slice.weekEndMs,
      catchUpFloors:
        idx === 0
          ? ctx.catchUpFloors
          : settings.allocator.catchUpMode === "automated"
            ? {}
            : undefined,
      weekAnchorDate: idx === 0 ? plan.weekStart : slice.weekAnchorDate,
      goalOverrideSources: goalOverrideSourcesFromPlan(plan),
      nowMs,
      sleepIntervals: sleepIntervalsForAllocation(slice.systemBlocks, slice.busy)
    })
  );

  let mergedGoalBlocks = mergeOrphanGoalOverrideBlocks(
    allocationSlices.flatMap((a) => a.blocks),
    plan,
    mergeWindows
  );

  let proposedBlocksRaw = filterInvertedTimemapFromProposedBlocks(
    mergedGoalBlocks,
    plan,
    settings.calendars.sources
  );

  if (ctx.scheduleHorizon.trialRollingClip) {
    proposedBlocksRaw = clipIntervalBlocksToHorizon(
      proposedBlocksRaw,
      ctx.scheduleHorizon.horizonEndMs
    );
  }

  const proposedBlocks = coalesceAdjacentWeeklyGoalBlocksForIcs(proposedBlocksRaw);
  const events = proposedBlocks.map((b) => toGeneratedEvent(userId, plan, b));
  const gymTravelBlocks = gymGoalTravelBlocksFromProposed(
    proposedBlocks,
    schedulingGoalsWithWeeklyRoutines(plan.goals, settings),
    settings.travel,
    settings.gym
  );
  const systemEvents = [
    ...ctx.weekSlices.flatMap((s) => s.systemBlocks.map((b) => toGeneratedSystemEvent(userId, b))),
    ...gymTravelBlocks.map((b) => toGeneratedSystemEvent(userId, b))
  ];

  const weatherClipped = ctx.weatherTimemapEvents.filter(
    (e) => e.endMs > nowMs && e.startMs < snapshotEndMs
  );

  const invertedTimemap = invertedCalendarTimemapEvents({
    userId,
    plan,
    goalAvailabilityWindows: ctx.busyFetch.goalAvailabilityWindows,
    calendarSources: settings.calendars.sources,
    windowStartMs: nowMs,
    windowEndMs: snapshotEndMs,
    stableUid: buildStableUid
  });

  const mergedEvents = [...events, ...systemEvents, ...weatherClipped, ...invertedTimemap].sort(
    (a, b) => a.startMs - b.startMs
  );

  await saveSnapshot(userId, {
    generatedAt: Date.now(),
    windowStartMs: nowMs,
    windowEndMs: snapshotEndMs,
    events: mergedEvents
  });

  return { eventCount: mergedEvents.length };
}
