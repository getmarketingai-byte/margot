import type { UserSettings } from "@calendar-automations/schema";
import { localMondayMidnightMs } from "@/lib/week";
import type { BillingState } from "@/lib/subscription";
import { DAY_MS, WEEK_MS, effectiveScheduleHorizon } from "@/lib/effective-schedule-horizon";

/**
 * Same fetch window as {@link loadPlanWeekAllocationInputs} so cached busy data
 * always covers Perfect Week, regeneration, and narrower callers (review pages).
 */
export function googleBusyFetchWindowForPlanner(
  settings: UserSettings,
  nowMs: number,
  billing: BillingState
): { fetchStartMs: number; fetchEndMs: number } {
  const tz = settings.timezone;
  const schedulingDays = settings.calendars.schedulingWindowDays;
  const snapshotEndMs = nowMs + schedulingDays * DAY_MS;
  const weekStartMs = localMondayMidnightMs(tz, new Date(nowMs));

  const horizon = effectiveScheduleHorizon({
    billing,
    storedScheduleHorizonWeeks: settings.calendars.scheduleHorizonWeeks,
    nowMs,
    baseWeekStartMs: weekStartMs
  });

  const allocationSpanEndMs = weekStartMs + horizon.isoWeekCount * WEEK_MS;
  const fetchStartMs = Math.min(weekStartMs, nowMs);
  const fetchEndMs = Math.max(snapshotEndMs, allocationSpanEndMs);
  return { fetchStartMs, fetchEndMs };
}
