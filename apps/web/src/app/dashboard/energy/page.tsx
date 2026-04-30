/**
 * Planning hub (the "second page" of the dashboard).
 *
 * The hub is the strategic surface that pairs framework-aware classification
 * boards with weekly intentions and long-horizon vision, optional scheduling methods
 * (Build your system), and global allocator rules. My Perfect Week lists concrete
 * goals and calendar preview.
 */

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  coerceSettingsAfterSchedulerFrameworkInclusionPatch,
  filterSchedulingGoals,
  type PlacementSignalKey,
  type SchedulerFrameworkInclusion,
  type VisionSettings,
  type WeeklyPlan,
  placementPrioritySettingsSchema,
  schedulerFrameworkInclusionSchema,
  visionSettingsSchema,
  weeklyIntentSchema
} from "@calendar-automations/schema";
import { allocateWeek, goalOverrideSourcesFromPlan } from "@calendar-automations/planner";
import { authOrPreview } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { loadPlanWeekAllocationInputs } from "@/lib/allocation-run-context";
import { loadSettings, saveSettings } from "@/lib/settings-store";
import { localMondayIso } from "@/lib/week";
import { sleepIntervalsFromSystemBlocks } from "@/lib/week-blocks";
import { updateWeeklyIntent } from "../plan/actions";
import { BuildYourSystemPanel } from "./build-your-system-panel";
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

async function patchSchedulerFrameworkInclusion(
  patch: Partial<SchedulerFrameworkInclusion>
): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const schedulerFrameworkInclusion = schedulerFrameworkInclusionSchema.parse({
    ...settings.schedulerFrameworkInclusion,
    ...patch
  });
  await saveSettings(
    userId,
    coerceSettingsAfterSchedulerFrameworkInclusionPatch({
      ...settings,
      schedulerFrameworkInclusion
    })
  );
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
  const nowMs = Date.now();
  const ctx = await loadPlanWeekAllocationInputs({ userId, plan, settings, nowMs });
  const {
    busyFetch,
    weekStartMs,
    weekEndMs,
    busy,
    systemBlocks,
    niceWeatherThisWeek,
    daySheetGoalBusyThisWeek,
    dayCalendarDrainThisWeek
  } = ctx;
  const resolvedCatchUpFloors = ctx.catchUpFloors;

  const allocation = allocateWeek({
    plan,
    busy: [...busy, ...daySheetGoalBusyThisWeek, ...systemBlocks],
    goalAvailabilityWindows: busyFetch.goalAvailabilityWindows,
    niceWeatherWindows: niceWeatherThisWeek,
    settings,
    weekStartMs,
    weekEndMs,
    catchUpFloors: resolvedCatchUpFloors,
    weekAnchorDate: plan.weekStart,
    goalOverrideSources: goalOverrideSourcesFromPlan(plan),
    nowMs,
    sleepIntervals: sleepIntervalsFromSystemBlocks(systemBlocks)
  });
  const tuningHints = allocation.metrics.personalEnergyPlan?.tuningHints ?? [];

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">Planning</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          Start with why (intentions, vision), then <strong>classify goals</strong> with the frameworks
          you actually use. Turn on optional <strong>scheduling methods</strong> in the middle when you
          want extra nuance—otherwise the built-in allocator stays the same. Finish with{" "}
          <strong>scheduling rules</strong> at the bottom for catch-up, energy curve, and caps. All of
          this feeds{" "}
          <a className="underline" href="/dashboard/plan">
            My Perfect Week
          </a>
          .
        </p>
      </header>

      <PlanningHubClient
        initialGoals={schedulingGoals}
        initialIntent={plan.weeklyIntent}
        initialVision={settings.vision}
        initialPlacementOrder={settings.placementPriority.order}
        wheelAreas={wheelAreas}
        schedulerFrameworkInclusion={settings.schedulerFrameworkInclusion}
        saveVision={updateVision}
        savePlacementOrder={updatePlacementPriority}
        saveWeeklyIntent={updateWeeklyIntent}
        patchSchedulerFrameworkInclusion={patchSchedulerFrameworkInclusion}
      />

      <div id="personal-scheduling" className="scroll-mt-6">
        <BuildYourSystemPanel
          initial={settings.personalSystem}
          dayDrain={dayCalendarDrainThisWeek}
          tuningHints={tuningHints}
        />
      </div>

      <ConstraintsSection />
    </div>
  );
}
