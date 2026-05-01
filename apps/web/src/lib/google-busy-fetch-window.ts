import type { UserSettings } from "@calendar-automations/schema";
import { localMondayMidnightMs } from "@/lib/week";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Same fetch window as {@link loadPlanWeekAllocationInputs} so cached busy data
 * always covers Perfect Week, regeneration, and narrower callers (review pages).
 */
export function googleBusyFetchWindowForPlanner(
  settings: UserSettings,
  nowMs: number
): { fetchStartMs: number; fetchEndMs: number } {
  const tz = settings.timezone;
  const schedulingDays = settings.calendars.schedulingWindowDays;
  const snapshotEndMs = nowMs + schedulingDays * DAY_MS;
  const weekStartMs = localMondayMidnightMs(tz, new Date(nowMs));
  const weekEndMs = weekStartMs + 7 * DAY_MS;
  const nextWeekEndMs = weekEndMs + 7 * DAY_MS;
  const fetchStartMs = Math.min(weekStartMs, nowMs);
  const fetchEndMs = Math.max(snapshotEndMs, nextWeekEndMs);
  return { fetchStartMs, fetchEndMs };
}
