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
  weeklyIntentSchema
} from "@calendar-automations/schema";
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
import { EnergyOrderingForm } from "./rule-forms/energy-ordering-form";
import { FrameworkRulesReview } from "./rule-forms/framework-rules-review";
import { Hp6HabitsForm } from "./rule-forms/hp6-habits-form";
import { PpfMixForm } from "./rule-forms/ppf-mix-form";
import { WheelOfLifeForm } from "./rule-forms/wheel-of-life-form";
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
  revalidatePath("/dashboard/planner");
}

export default async function PlannerHubPage() {
  const session = await authOrPreview();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);
  const plan = await loadPlan(userId, settings.timezone);
  const perfectWeekAuthoringGoals = filterSchedulingGoals(plan.goals).filter(
    (g) => g.specialGoalType !== "gym" && g.specialGoalType !== "errands"
  );
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
        <h1 className="text-2xl font-semibold">Planner</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          Flow:{" "}
          <a className="underline" href="#why-weekly-intent-heading">
            Why &amp; weekly intent
          </a>
          , then{" "}
          <a className="underline" href="#scheduling-outcomes-heading">
            Scheduling options
          </a>
          {" "}(routines + global allocator mechanics), your{" "}
          <a className="underline" href="#framework-system-heading">
            Framework system
          </a>
          {" "}(choose frameworks + tag goals), and the{" "}
          <a className="underline" href="#framework-methods-heading">
            Framework rule customiser
          </a>
          {" "}(numeric rules + optional methods). Together they feed{" "}
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

      <ConstraintsSection />

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
            Enable allocator frameworks and classify goals on boards. Numeric floors, mix targets, and
            energy ordering live in{" "}
            <a className="underline" href="#framework-methods-heading">
              Framework rule customiser
            </a>
            ; global mechanics (catch-up, routines, starvation) are in{" "}
            <a className="underline" href="#scheduling-outcomes-heading">
              Scheduling options
            </a>
            {" "}(above).
          </p>
        </header>

        <PlanningHubClient
          initialGoals={perfectWeekAuthoringGoals}
          initialFrameworkSystem={settings.frameworkSystem}
          initialPlacementOrder={settings.placementPriority.order}
          wheelAreas={wheelAreas}
          schedulerFrameworkInclusion={settings.schedulerFrameworkInclusion}
          savePlacementOrder={updatePlacementSignalsFromFramework}
        />
      </section>

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
            Review how selected frameworks tie to allocator rules, then tune floors, mix, habits, and
            energy ordering here. Enable optional scheduling method modules for optimisation on top of
            the defaults.             Broad allocator behaviour is in{" "}
            <a className="underline" href="#scheduling-outcomes-heading">
              Scheduling options
            </a>
            {" "}(above).
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
    </div>
  );
}
