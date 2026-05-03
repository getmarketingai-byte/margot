/**
 * Planner hub (`/dashboard/planner`): strategic framework tagging, framework rule customiser,
 * and global scheduling options. Legacy `/dashboard/energy` redirects here.
 */

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  filterSchedulingGoals,
  type VisionSettings,
  type WeeklyPlan,
  visionSettingsSchema,
  weeklyIntentSchema,
  weeklyPlanSchema
} from "@calendar-automations/schema";
import { allocateWeek, goalOverrideSourcesFromPlan } from "@calendar-automations/planner";
import { authOrPreview } from "@/lib/auth";
import {
  getCachedPlanWeekAllocationInputs,
  invalidateUserAllocationCache
} from "@/lib/cached-plan-week-allocation-inputs";
import { loadBillingState } from "@/lib/billing-state-server";
import { db, schema } from "@/lib/db";
import { loadSettings, saveSettings } from "@/lib/settings-store";
import { localMondayIso } from "@/lib/week";
import { sleepIntervalsForAllocation } from "@/lib/week-blocks";
import { processExpiredWeeklyPlanTrash } from "@/lib/weekly-plan-trash";
import { updateWeeklyIntent } from "../plan/actions";
import { BuildYourSystemPanel } from "./build-your-system-panel";
import { ConstraintsSection } from "./constraints-section";
import { updatePlacementSignalsFromFramework } from "./framework-system-actions";
import { GoalGroupsPanel } from "./goal-groups-panel";
import { PlanningHubClient } from "./planning-hub-client";
import { EnergyOrderingForm } from "./rule-forms/energy-ordering-form";
import { FrameworkRulesReview } from "./rule-forms/framework-rules-review";
import { Hp6HabitsForm } from "./rule-forms/hp6-habits-form";
import { PpfMixForm } from "./rule-forms/ppf-mix-form";
import { WheelOfLifeForm } from "./rule-forms/wheel-of-life-form";
import { PlannerHubTabs } from "./planner-hub-tabs";
import { PlannerTagSubtabs } from "./planner-tag-subtabs";
import { WhyWeeklyIntentSection } from "./why-weekly-intent-section";

export const dynamic = "force-dynamic";

async function loadPlan(userId: string, timezone: string): Promise<WeeklyPlan> {
  const weekStart = localMondayIso(timezone);
  const blank = weeklyIntentSchema.parse({});
  if (!db) {
    return processExpiredWeeklyPlanTrash(
      userId,
      weeklyPlanSchema.parse({
        id: "dev",
        weekStart,
        timezone,
        goals: [],
        deletedGoals: [],
        goalGroups: [],
        overrides: [],
        weeklyIntent: blank
      })
    );
  }
  const rows = await db
    .select()
    .from(schema.weeklyPlans)
    .where(eq(schema.weeklyPlans.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return processExpiredWeeklyPlanTrash(
      userId,
      weeklyPlanSchema.parse({
        id: crypto.randomUUID(),
        weekStart,
        timezone,
        goals: [],
        deletedGoals: [],
        goalGroups: [],
        overrides: [],
        weeklyIntent: blank
      })
    );
  }
  const stored = row.data as Partial<WeeklyPlan>;
  const plan = weeklyPlanSchema.parse({
    ...stored,
    id: row.id,
    weekStart,
    timezone,
    goals: stored.goals ?? [],
    deletedGoals: stored.deletedGoals ?? [],
    goalGroups: stored.goalGroups ?? [],
    overrides: stored.overrides ?? [],
    weeklyIntent: weeklyIntentSchema.parse(stored.weeklyIntent ?? {})
  });
  return processExpiredWeeklyPlanTrash(userId, plan);
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
  revalidatePath("/dashboard/planner");
}

export default async function PlannerHubPage() {
  const session = await authOrPreview();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);
  const plan = await loadPlan(userId, settings.timezone);
  const perfectWeekAuthoringGoals = filterSchedulingGoals(plan.goals);
  const wheelAreas = settings.wheel.areas.map((a) => ({ id: a.id, label: a.label }));
  const nowMs = Date.now();
  const billing = await loadBillingState(userId);
  const ctx = await getCachedPlanWeekAllocationInputs({
    userId,
    plan,
    settings,
    nowMs,
    billing
  });
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
    sleepIntervals: sleepIntervalsForAllocation(systemBlocks, busy)
  });
  const tuningHints = allocation.metrics.personalEnergyPlan?.tuningHints ?? [];

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">Planner</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          Turn intentions and frameworks into how blocks land on your calendar. Output feeds{" "}
          <a className="underline" href="/dashboard/plan">
            My Perfect Week
          </a>
          .
        </p>
        <details className="mt-3 rounded-lg border border-ink-200/90 bg-ink-50/30 px-3 py-2 text-sm dark:border-ink-600 dark:bg-ink-900/25">
          <summary className="cursor-pointer font-medium text-ink-800 dark:text-ink-100">
            How this fits together
          </summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-ink-600 dark:text-ink-200">
            <li>
              <a className="underline" href="#planner-intent">
                Intent
              </a>{" "}
              — weekly words and optional long-horizon vision.
            </li>
            <li>
              <a className="underline" href="#planner-scheduling">
                Scheduling
              </a>{" "}
              — routines and global allocator behaviour.
            </li>
            <li>
              <a className="underline" href="#planner-tag">
                Tag goals
              </a>{" "}
              — enable frameworks and classify Perfect Week goals.
            </li>
            <li>
              <a className="underline" href="#planner-rules">
                Rules
              </a>{" "}
              — numeric floors, mix, habits, energy ordering, and system modules.
            </li>
          </ol>
        </details>
      </header>

      <PlannerHubTabs
        intentPanel={
          <WhyWeeklyIntentSection
            initialWeeklyIntent={plan.weeklyIntent}
            initialVision={settings.vision}
            saveWeeklyIntent={updateWeeklyIntent}
            saveVision={updateVision}
          />
        }
        schedulingPanel={<ConstraintsSection />}
        tagPanel={
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
                Pick frameworks and drag goals onto boards. Tune numbers in{" "}
                <a className="underline" href="#framework-methods-heading">
                  Rules
                </a>
                ; global mechanics live under{" "}
                <a className="underline" href="#scheduling-outcomes-heading">
                  Scheduling
                </a>
                .
              </p>
            </header>

            <PlannerTagSubtabs
              frameworksPanel={
                <PlanningHubClient
                  initialGoals={perfectWeekAuthoringGoals}
                  initialFrameworkSystem={settings.frameworkSystem}
                  initialPlacementOrder={settings.placementPriority.order}
                  wheelAreas={wheelAreas}
                  schedulerFrameworkInclusion={settings.schedulerFrameworkInclusion}
                  savePlacementOrder={updatePlacementSignalsFromFramework}
                />
              }
              goalGroupsPanel={
                <GoalGroupsPanel
                  initialGoalGroups={plan.goalGroups ?? []}
                  schedulingGoals={perfectWeekAuthoringGoals}
                  freeMinutesThisWeek={allocation.metrics.utilisation.weekCapacityMinutes}
                />
              }
            />
          </section>
        }
        rulesPanel={
          <section
            id="framework-methods"
            className="flex scroll-mt-6 flex-col gap-5"
            aria-labelledby="framework-methods-heading"
          >
            <header>
              <h2 id="framework-methods-heading" className="text-lg font-semibold">
                Framework rule customiser
              </h2>
              <p className="mt-1 text-sm text-ink-600 dark:text-ink-200">
                Align allocator numbers with the frameworks you enabled in Tag goals. Broad behaviour
                (catch-up, starvation, etc.) stays under{" "}
                <a className="underline" href="#scheduling-outcomes-heading">
                  Scheduling
                </a>
                .
              </p>
            </header>

            <FrameworkRulesReview
              schedulerFrameworkInclusion={settings.schedulerFrameworkInclusion}
              wheel={settings.wheel}
              ppf={settings.ppf}
              hpp={settings.hpp}
              energyOrdering={settings.energyOrdering}
            />

            <div className="flex flex-col gap-4">
              <EnergyOrderingForm mode={settings.energyOrdering.mode} />
              <WheelOfLifeForm wheel={settings.wheel} />
              <PpfMixForm targets={settings.ppf.targets} />
              <Hp6HabitsForm hp6MinTouchesPerMonth={settings.hpp.hp6MinTouchesPerMonth} />
              <BuildYourSystemPanel
                variant="embedded"
                initial={settings.personalSystem}
                dayDrain={dayCalendarDrainThisWeek}
                tuningHints={tuningHints}
              />
            </div>
          </section>
        }
      />
    </div>
  );
}
