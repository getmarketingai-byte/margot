"use server";

import { authOrPreview } from "@/lib/auth";
import { invalidateUserAllocationCache } from "@/lib/cached-plan-week-allocation-inputs";
import { revalidatePlanningRoutes } from "@/lib/dashboard-revalidate";
import { loadSettings, saveSettings } from "@/lib/settings-store";
import type { GymSettings } from "@calendar-automations/schema";
import { z } from "zod";

function afterPhysicalRoutineSave(userId: string): void {
  invalidateUserAllocationCache(userId);
  revalidatePlanningRoutes();
}

const plannerDay = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
]);

const clock = z.object({
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59)
});

const routinePayloadSchema = z
  .object({
    plannerBlockEnabled: z.boolean(),
    blockLabel: z.string().min(1).max(120),
    sessionsPerWeekMin: z.number().int().min(1).max(14),
    sessionsPerWeekMax: z.number().int().min(1).max(14),
    sessionMinutesMin: z.number().int().min(1).max(240),
    sessionMinutesMax: z.number().int().min(1).max(240),
    plannerDaysOfWeek: z.array(plannerDay).min(1).max(7).optional(),
    idealBlockTimes: z.array(clock).min(1).max(8),
    earliestStart: clock,
    latestEnd: clock,
    minMinutesPerBlock: z.number().int().min(15).max(8 * 60).optional(),
    maxAutoBlocksPerDay: z.number().int().min(1).max(8).optional()
  })
  .superRefine((p, ctx) => {
    if (p.sessionMinutesMin > p.sessionMinutesMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sessionMinutesMin cannot exceed sessionMinutesMax",
        path: ["sessionMinutesMax"]
      });
    }
    if (p.sessionsPerWeekMin > p.sessionsPerWeekMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sessionsPerWeekMin cannot exceed sessionsPerWeekMax",
        path: ["sessionsPerWeekMax"]
      });
    }
  });

export async function savePhysicalActivityRoutine(formData: FormData): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);

  const jsonRaw = formData.get("routine_payload_json");
  if (typeof jsonRaw !== "string" || !jsonRaw.trim()) return;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonRaw);
  } catch {
    return;
  }

  const parsed = routinePayloadSchema.safeParse(parsedJson);
  if (!parsed.success) return;

  const p = parsed.data;
  let sessionsPerWeekMin = p.sessionsPerWeekMin;
  let sessionsPerWeekMax = p.sessionsPerWeekMax;
  if (sessionsPerWeekMin > sessionsPerWeekMax) {
    const t = sessionsPerWeekMin;
    sessionsPerWeekMin = sessionsPerWeekMax;
    sessionsPerWeekMax = t;
  }
  let sessionMinutesMin = p.sessionMinutesMin;
  let sessionMinutesMax = p.sessionMinutesMax;
  if (sessionMinutesMin > sessionMinutesMax) {
    const t = sessionMinutesMin;
    sessionMinutesMin = sessionMinutesMax;
    sessionMinutesMax = t;
  }

  const sessionsPerWeek = sessionsPerWeekMax;
  const runMinutes = sessionMinutesMax;
  const plannerDaysOfWeek: GymSettings["plannerDaysOfWeek"] =
    p.plannerDaysOfWeek && p.plannerDaysOfWeek.length > 0 ? [...p.plannerDaysOfWeek] : undefined;

  await saveSettings(userId, {
    ...settings,
    gym: {
      ...settings.gym,
      plannerBlockEnabled: p.plannerBlockEnabled,
      blockLabel: p.blockLabel.trim() || "Physical activity",
      sessionsPerWeek,
      sessionsPerWeekMin,
      sessionsPerWeekMax,
      runMinutes,
      sessionMinutesMin,
      sessionMinutesMax,
      idealBlockTimes: p.idealBlockTimes,
      plannerDaysOfWeek,
      earliestStart: p.earliestStart,
      latestEnd: p.latestEnd,
      minMinutesPerBlock: p.minMinutesPerBlock,
      maxAutoBlocksPerDay: p.maxAutoBlocksPerDay
    }
  });
  afterPhysicalRoutineSave(userId);
}
