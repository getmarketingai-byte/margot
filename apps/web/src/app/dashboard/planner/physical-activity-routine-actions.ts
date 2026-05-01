"use server";

import { authOrPreview } from "@/lib/auth";
import { invalidateUserAllocationCache } from "@/lib/cached-plan-week-allocation-inputs";
import { revalidatePlanningRoutes } from "@/lib/dashboard-revalidate";
import { loadSettings, saveSettings } from "@/lib/settings-store";
import type { GymSettings } from "@calendar-automations/schema";

function afterPhysicalRoutineSave(userId: string): void {
  invalidateUserAllocationCache(userId);
  revalidatePlanningRoutes();
}

function parseIdealTimesJson(raw: unknown): GymSettings["idealBlockTimes"] | null {
  if (raw == null || raw === "") return null;
  try {
    const v = JSON.parse(String(raw)) as unknown;
    if (!Array.isArray(v) || v.length === 0) return null;
    const out: GymSettings["idealBlockTimes"] = [];
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

export async function savePhysicalActivityRoutine(formData: FormData): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);

  const plannerBlockEnabled = formData.get("planner_block_enabled") === "on";
  const blockLabel = String(formData.get("block_label") ?? "").trim() || "Physical activity";
  const sessionsPerWeek = Math.max(
    1,
    Math.min(14, Number(formData.get("sessions_per_week") ?? settings.gym.sessionsPerWeek))
  );
  const runMinutes = Math.max(
    1,
    Math.min(240, Number(formData.get("run_minutes") ?? settings.gym.runMinutes))
  );
  const parsedTimes = parseIdealTimesJson(formData.get("ideal_times_json"));
  const idealBlockTimes = parsedTimes ?? settings.gym.idealBlockTimes;

  const pinRaw = formData.get("planner_days");
  let plannerDaysOfWeek: GymSettings["plannerDaysOfWeek"] = undefined;
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
      .filter((d) => allowed.has(d)) as NonNullable<GymSettings["plannerDaysOfWeek"]>;
    plannerDaysOfWeek = days.length > 0 ? days : undefined;
  }

  await saveSettings(userId, {
    ...settings,
    gym: {
      ...settings.gym,
      plannerBlockEnabled,
      blockLabel,
      sessionsPerWeek,
      runMinutes,
      idealBlockTimes,
      plannerDaysOfWeek
    }
  });
  afterPhysicalRoutineSave(userId);
}
