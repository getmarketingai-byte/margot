"use server";

import { authOrPreview } from "@/lib/auth";
import { invalidateUserAllocationCache } from "@/lib/cached-plan-week-allocation-inputs";
import { revalidatePlanningRoutes } from "@/lib/dashboard-revalidate";
import { loadSettings, saveSettings } from "@/lib/settings-store";
import type { WeeklyErrandsRoutine } from "@calendar-automations/schema";

function afterWeeklyErrandsSave(userId: string): void {
  invalidateUserAllocationCache(userId);
  revalidatePlanningRoutes();
}

function parseIdealTimesJson(raw: unknown): WeeklyErrandsRoutine["idealBlockTimes"] | null {
  if (raw == null || raw === "") return null;
  try {
    const v = JSON.parse(String(raw)) as unknown;
    if (!Array.isArray(v) || v.length === 0) return null;
    const out: WeeklyErrandsRoutine["idealBlockTimes"] = [];
    for (const row of v.slice(0, 8)) {
      if (!row || typeof row !== "object") continue;
      const h = Number((row as { hour?: unknown }).hour);
      const m = Number((row as { minute?: unknown }).minute);
      if (!Number.isInteger(h) || h < 0 || h > 23) continue;
      if (!Number.isInteger(m) || m < 0 || m > 59) continue;
      out.push({ hour: h, minute: m });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export async function saveWeeklyErrandsRoutine(formData: FormData): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);

  const plannerBlockEnabled = formData.get("errands_planner_block_enabled") === "on";
  const blockLabel = String(formData.get("errands_block_label") ?? "").trim() || "Errands";
  const sessionsPerWeek = Math.max(
    1,
    Math.min(14, Number(formData.get("errands_sessions_per_week") ?? settings.weeklyErrands.sessionsPerWeek))
  );
  const sessionMinutes = Math.max(
    1,
    Math.min(240, Number(formData.get("errands_session_minutes") ?? settings.weeklyErrands.sessionMinutes))
  );
  const earliestHour = Math.max(
    0,
    Math.min(23, Number(formData.get("errands_earliest_hour") ?? settings.weeklyErrands.earliestHour))
  );
  const latestHour = Math.max(
    earliestHour + 1,
    Math.min(24, Number(formData.get("errands_latest_hour") ?? settings.weeklyErrands.latestHour))
  );
  const parsedTimes = parseIdealTimesJson(formData.get("errands_ideal_times_json"));
  const idealBlockTimes = parsedTimes ?? settings.weeklyErrands.idealBlockTimes;

  const pinRaw = formData.get("errands_planner_days");
  let plannerDaysOfWeek: WeeklyErrandsRoutine["plannerDaysOfWeek"] = undefined;
  if (typeof pinRaw === "string" && pinRaw.trim() !== "") {
    const allowed = new Set([
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday"
    ]);
    const days = pinRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((d) => allowed.has(d)) as NonNullable<WeeklyErrandsRoutine["plannerDaysOfWeek"]>;
    plannerDaysOfWeek = days.length > 0 ? days : undefined;
  }

  await saveSettings(userId, {
    ...settings,
    weeklyErrands: {
      ...settings.weeklyErrands,
      plannerBlockEnabled,
      blockLabel,
      sessionsPerWeek,
      sessionMinutes,
      earliestHour,
      latestHour,
      idealBlockTimes,
      plannerDaysOfWeek
    }
  });
  afterWeeklyErrandsSave(userId);
}
