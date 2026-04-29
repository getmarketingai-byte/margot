/**
 * Builds ICS `timemap` events from invert-free-busy calendar windows so feeds
 * (e.g. SkedPal) can subscribe without using allocator goal blocks.
 */

import type { GeneratedEvent, WeeklyPlan } from "@calendar-automations/schema";
import {
  calendarBusyModeForSource,
  normaliseCalendarSource,
  type CalendarSource
} from "@calendar-automations/schema";
import type { Interval } from "@calendar-automations/planner";
import { clip } from "@calendar-automations/planner";

export function invertedCalendarTimemapEvents(options: {
  userId: string;
  plan: WeeklyPlan;
  goalAvailabilityWindows: Record<string, Interval[]>;
  calendarSources: readonly CalendarSource[];
  windowStartMs: number;
  windowEndMs: number;
  stableUid: (parts: readonly (string | number)[]) => string;
}): GeneratedEvent[] {
  const {
    userId,
    plan,
    goalAvailabilityWindows,
    calendarSources,
    windowStartMs,
    windowEndMs,
    stableUid
  } = options;
  const out: GeneratedEvent[] = [];
  const goalById = new Map(plan.goals.map((g) => [g.id, g] as const));

  for (const srcRaw of calendarSources) {
    const src = normaliseCalendarSource(srcRaw);
    if (src.provider !== "google") continue;
    if (calendarBusyModeForSource(src) !== "invert-free-busy") continue;
    const goalId = src.availabilityGoalId;
    if (!goalId) continue;
    const windows = goalAvailabilityWindows[goalId];
    if (!windows?.length) continue;

    const goal = goalById.get(goalId);
    const title =
      (goal?.title && goal.title.trim()) || src.displayName.trim() || "Calendar availability";

    for (const w of windows) {
      const clipped = clip(w, windowStartMs, windowEndMs);
      if (!clipped || clipped.endMs <= clipped.startMs) continue;
      out.push({
        uid: stableUid(["inverted-timemap", goalId, clipped.startMs, clipped.endMs, userId]),
        kind: "timemap",
        title,
        startMs: clipped.startMs,
        endMs: clipped.endMs,
        busy: false,
        tags: ["inverted-calendar", `goal:${goalId}`]
      });
    }
  }

  return out;
}
