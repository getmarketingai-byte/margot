/**
 * Planning hub (the "second page" of the dashboard).
 *
 * The hub is the strategic surface that pairs framework-aware classification
 * boards with weekly intentions and a long-horizon vision. The Perfect Week
 * page handles when things land on the calendar; the planning hub handles
 * why each goal exists, which framework lens applies, and how non-negotiable
 * each commitment is. All edits flow through the same goal/plan server
 * actions so the allocator stays single-source-of-truth.
 */

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  filterSchedulingGoals,
  type PlacementSignalKey,
  type VisionSettings,
  type WeeklyPlan,
  placementPrioritySettingsSchema,
  visionSettingsSchema,
  weeklyIntentSchema
} from "@calendar-automations/schema";
import { authOrPreview } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { loadSettings, saveSettings } from "@/lib/settings-store";
import { localMondayIso } from "@/lib/week";
import { updateWeeklyIntent } from "../plan/actions";
import { ConstraintsSection } from "./constraints-section";
import { PlanningHubClient } from "./planning-hub-client";

export const dynamic = "force-dynamic";

async function loadPlan(userId: string, timezone: string): Promise<WeeklyPlan> {
  const weekStart = localMondayIso(timezone);
  const blank = weeklyIntentSchema.parse({});
  if (!db) {
    return {
      id: "dev",
      weekStart,
      timezone,
      goals: [],
      overrides: [],
      weeklyIntent: blank
    };
  }
  const rows = await db
    .select()
    .from(schema.weeklyPlans)
    .where(eq(schema.weeklyPlans.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return {
      id: crypto.randomUUID(),
      weekStart,
      timezone,
      goals: [],
      overrides: [],
      weeklyIntent: blank
    };
  }
  const stored = row.data as Partial<WeeklyPlan>;
  return {
    ...stored,
    id: row.id,
    weekStart,
    timezone,
    goals: stored.goals ?? [],
    overrides: stored.overrides ?? [],
    weeklyIntent: weeklyIntentSchema.parse(stored.weeklyIntent ?? {})
  };
}

async function updateVision(input: VisionSettings): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  await saveSettings(userId, {
    ...settings,
    vision: visionSettingsSchema.parse(input)
  });
  revalidatePath("/dashboard/energy");
}

async function updatePlacementPriority(
  order: readonly PlacementSignalKey[]
): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const parsed = placementPrioritySettingsSchema.parse({ order });
  await saveSettings(userId, {
    ...settings,
    placementPriority: parsed
  });
  revalidatePath("/dashboard/energy");
  revalidatePath("/dashboard/plan");
}

async function updateFrameworkInScheduler(
  framework: "wheel" | "ppf" | "hpp",
  enabled: boolean
): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  if (framework === "wheel") {
    await saveSettings(userId, {
      ...settings,
      wheel: { ...settings.wheel, enabled }
    });
  } else if (framework === "ppf") {
    await saveSettings(userId, {
      ...settings,
      ppf: { ...settings.ppf, enabled }
    });
  } else {
    await saveSettings(userId, {
      ...settings,
      hpp: { ...settings.hpp, enabled }
    });
  }
  revalidatePath("/dashboard/energy");
  revalidatePath("/dashboard/plan");
}

export default async function PlanningHubPage() {
  const session = await authOrPreview();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);
  const plan = await loadPlan(userId, settings.timezone);
  const schedulingGoals = filterSchedulingGoals(plan.goals);
  const wheelAreas = settings.wheel.areas.map((a) => ({ id: a.id, label: a.label }));

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">Planning</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          Set the week&apos;s intentions, classify each goal across the frameworks you trust, tune
          allocator rules at the bottom, and decide which framework wins when they disagree.
          Everything here feeds the Perfect Week calendar.
        </p>
      </header>

      <PlanningHubClient
        initialGoals={schedulingGoals}
        initialIntent={plan.weeklyIntent}
        initialVision={settings.vision}
        initialPlacementOrder={settings.placementPriority.order}
        wheelAreas={wheelAreas}
        wheelSchedulerEnabled={settings.wheel.enabled}
        ppfSchedulerEnabled={settings.ppf.enabled}
        hppSchedulerEnabled={settings.hpp.enabled}
        saveVision={updateVision}
        savePlacementOrder={updatePlacementPriority}
        saveWeeklyIntent={updateWeeklyIntent}
        saveFrameworkScheduler={updateFrameworkInScheduler}
      />

      <ConstraintsSection />
    </div>
  );
}
