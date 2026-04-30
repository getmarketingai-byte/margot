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
import { filterSchedulingGoals, type VisionSettings, type WeeklyPlan, visionSettingsSchema, weeklyIntentSchema } from "@calendar-automations/schema";
import { allocateWeek, goalOverrideSourcesFromPlan } from "@calendar-automations/planner";
import { authOrPreview } from "@/lib/auth";
import {
  getCachedPlanWeekAllocationInputs,
  invalidateUserAllocationCache
} from "@/lib/cached-plan-week-allocation-inputs";
import { db, schema } from "@/lib/db";
import { loadSettings, saveSettings } from "@/lib/settings-store";
import { localMondayIso } from "@/lib/week";
import { sleepIntervalsFromSystemBlocks } from "@/lib/week-blocks";
import { updateWeeklyIntent } from "../plan/actions";
import { BuildYourSystemPanel } from "./build-your-system-panel";
import { ConstraintsSection } from "./constraints-section";
import { updatePlacementSignalsFromFramework } from "./framework-system-actions";
import { PlanningHubClient } from "./planning-hub-client";
import { WhyWeeklyIntentSection } from "./why-weekly-intent-section";

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
  invalidateUserAllocationCache(userId);
  revalidatePath("/dashboard/energy");
}

export default async function PlanningHubPage() {
  const session = await authOrPreview();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);
  const plan = await loadPlan(userId, settings.timezone);
  const schedulingGoals = filterSchedulingGoals(plan.goals);
  const wheelAreas = settings.wheel.areas.map((a) => ({ id: a.id, label: a.label }));
  const nowMs = Date.now();
  const ctx = await getCachedPlanWeekAllocationInputs({ userId, plan, settings, nowMs });
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
          Three layers on this page:{" "}
          <a className="underline" href="#why-weekly-intent-heading">
            Why &amp; weekly intent
          </a>
          , your unified{" "}
          <a className="underline" href="#framework-system-heading">
            Framework system
          </a>{" "}
          (registry, goal boards, optional methods), then{" "}
          <a className="underline" href="#scheduling-outcomes-heading">
            Scheduling outcomes
          </a>
          . Together they feed{" "}
          <a className="underline" href="/dashboard/plan">
            My Perfect Week
          </a>
          .
        </p>
      </header>

      <WhyWeeklyIntentSection
        initialWeeklyIntent={plan.weeklyIntent}
        initialVision={settings.vision}
        saveWeeklyIntent={updateWeeklyIntent}
        saveVision={updateVision}
      />

      <section
        className="card flex flex-col gap-6 scroll-mt-6"
        id="framework-system"
        aria-labelledby="framework-system-heading"
      >
        <header>
          <h2 id="framework-system-heading" className="text-lg font-semibold">
            Framework system
          </h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-200">
            Enable frameworks and calendar overlays, classify goals on boards, optionally turn on
            advanced placement methods, then set placement tie-breaks. Rule floors and mix targets live
            under scheduling outcomes.
          </p>
        </header>

        <PlanningHubClient
          initialGoals={schedulingGoals}
          initialFrameworkSystem={settings.frameworkSystem}
          initialPlacementOrder={settings.placementPriority.order}
          wheelAreas={wheelAreas}
          schedulerFrameworkInclusion={settings.schedulerFrameworkInclusion}
          savePlacementOrder={updatePlacementSignalsFromFramework}
        />

        <div
          id="framework-methods"
          className="scroll-mt-6 border-t border-ink-200 pt-6 dark:border-ink-600"
        >
          <BuildYourSystemPanel
            variant="embedded"
            initial={settings.personalSystem}
            dayDrain={dayCalendarDrainThisWeek}
            tuningHints={tuningHints}
          />
        </div>
      </section>

      <ConstraintsSection />
    </div>
  );
}
