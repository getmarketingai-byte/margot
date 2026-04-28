import { eq } from "drizzle-orm";
import { type WeeklyPlan } from "@calendar-automations/schema";
import { allocateWeek, buildStableUid } from "@calendar-automations/planner";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { loadSettings, saveSettings } from "@/lib/settings-store";
import { fetchGoogleBusy } from "@/lib/google-calendar";
import { localMondayIso, localMondayMidnightMs } from "@/lib/week";
import { buildSystemBlocks, overridesFromPlan } from "@/lib/system-blocks-server";
import { computeSystemBlocks } from "@/lib/week-blocks";
import { createLegResolver } from "@/lib/routing";
import { buildWeatherTimemapEvents } from "@/lib/weather-timemap";
import { PlanClient } from "./plan-client";
import { ResizableColumns } from "./resizable-columns";
import { WeekCalendar } from "../week-calendar";
import { RangeToggleCalendar } from "./range-toggle-calendar";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

async function loadPlan(userId: string, timezone: string): Promise<WeeklyPlan> {
  const weekStart = localMondayIso(timezone);
  if (!db) {
    return { id: "dev", weekStart, timezone, goals: [], overrides: [] };
  }
  const rows = await db
    .select()
    .from(schema.weeklyPlans)
    .where(eq(schema.weeklyPlans.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { id: crypto.randomUUID(), weekStart, timezone, goals: [], overrides: [] };
  }
  const stored = row.data as WeeklyPlan;
  return { ...stored, id: row.id, weekStart, timezone, overrides: stored.overrides ?? [] };
}

async function updateRoutines(formData: FormData): Promise<void> {
  "use server";
  const session = await auth();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const morningEnabled = formData.get("morning_enabled") === "on";
  const shutdownEnabled = formData.get("shutdown_enabled") === "on";
  const morningMinutes = Math.max(
    0,
    Math.min(180, Number(formData.get("morning_minutes") ?? settings.timemap.morningRoutine.minutes))
  );
  const shutdownMinutes = Math.max(
    0,
    Math.min(180, Number(formData.get("shutdown_minutes") ?? settings.timemap.shutdownRoutine.minutes))
  );

  await saveSettings(userId, {
    ...settings,
    timemap: {
      ...settings.timemap,
      morningRoutine: {
        ...settings.timemap.morningRoutine,
        enabled: morningEnabled,
        minutes: morningMinutes
      },
      shutdownRoutine: {
        ...settings.timemap.shutdownRoutine,
        enabled: shutdownEnabled,
        minutes: shutdownMinutes
      }
    }
  });

  revalidatePath("/dashboard/plan");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/constraints");
}

export default async function PlanPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);
  const plan = await loadPlan(userId, settings.timezone);

  const weekStartMs = localMondayMidnightMs(settings.timezone);
  const weekEndMs = weekStartMs + 7 * 24 * 60 * 60 * 1000;
  const nextWeekStartMs = weekEndMs;
  const nextWeekEndMs = nextWeekStartMs + 7 * 24 * 60 * 60 * 1000;
  const busyFetch = await fetchGoogleBusy(
    userId,
    settings.calendars.sources,
    weekStartMs,
    nextWeekEndMs
  ).catch(() => ({ busyEvents: [], goalAvailabilityWindows: {} }));
  const busyAll = busyFetch.busyEvents;
  const busy = busyAll.filter((e) => e.endMs > weekStartMs && e.startMs < weekEndMs);
  const busyNextWeek = busyAll.filter((e) => e.endMs > nextWeekStartMs && e.startMs < nextWeekEndMs);
  // System blocks (sleep + travel) reserve time around real events. They're
  // merged into the busy stream so goals don't land on top of them, and
  // surfaced separately to the calendar for distinct visual styling.
  const systemBlocks = await buildSystemBlocks({
    userId,
    settings,
    weekStartMs,
    busy,
    overrides: overridesFromPlan(plan)
  });
  const nextWeekResolver = createLegResolver({
    travel: settings.travel,
    cache: settings.travelCache
  });
  const nextWeekSystemBlocks = await computeSystemBlocks(
    nextWeekStartMs,
    busyNextWeek,
    settings.sleep,
    settings.travel,
    settings.gym,
    settings.timezone,
    nextWeekResolver,
    settings.timemap
  );
  const allocation = allocateWeek({
    plan,
    busy: [...busy, ...systemBlocks],
    goalAvailabilityWindows: busyFetch.goalAvailabilityWindows,
    settings,
    weekStartMs,
    weekEndMs
  });
  const allocationNextWeek = allocateWeek({
    plan,
    busy: [...busyNextWeek, ...nextWeekSystemBlocks],
    goalAvailabilityWindows: busyFetch.goalAvailabilityWindows,
    settings,
    weekStartMs: nextWeekStartMs,
    weekEndMs: nextWeekEndMs
  });
  const busyForCalendar = [...busy, ...busyNextWeek];
  const weatherPreviewBlocks = (
    await buildWeatherTimemapEvents({
      userId,
      windowStartMs: weekStartMs,
      windowEndMs: nextWeekEndMs,
      weather: settings.weather,
      stableUid: buildStableUid
    })
  )
    .filter((e) => e.title === "[Outside]")
    .map((e) => ({
      sourceId: `weather-${e.startMs}-${e.endMs}`,
      title: e.title,
      startMs: e.startMs,
      endMs: e.endMs,
      busy: true,
      source: "internal" as const,
      system: "weather" as const
    }));
  const systemBlocksForCalendar = [...systemBlocks, ...nextWeekSystemBlocks, ...weatherPreviewBlocks];
  const proposedForCalendar = [...allocation.blocks, ...allocationNextWeek.blocks];

  const scheduledByGoal: Record<string, number> = {};
  const effectiveTargetByGoal: Record<string, number> = {};
  for (const [id, m] of Object.entries(allocation.metrics.perGoal)) {
    scheduledByGoal[id] = m.scheduledMinutes;
    effectiveTargetByGoal[id] = m.targetMinutes;
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">My Perfect Week</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          List the things you want each week. Type a goal and press Enter — we&apos;ll find the
          time.
        </p>
      </header>

      <section className="card">
        <div className="text-sm font-semibold">Daily routines</div>
        <p className="mt-1 text-xs text-ink-400">
          Morning and shutdown routines are reserved around sleep and block planner time-map slots
          from being placed in the same window.
        </p>
        <form action={updateRoutines} className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              name="morning_enabled"
              defaultChecked={settings.timemap.morningRoutine.enabled}
            />
            <span>Enable morning routine</span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              name="shutdown_enabled"
              defaultChecked={settings.timemap.shutdownRoutine.enabled}
            />
            <span>Enable shutdown routine</span>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Morning minutes
            <input
              type="number"
              name="morning_minutes"
              min={0}
              max={180}
              step={5}
              defaultValue={settings.timemap.morningRoutine.minutes}
              className="field"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Shutdown minutes
            <input
              type="number"
              name="shutdown_minutes"
              min={0}
              max={180}
              step={5}
              defaultValue={settings.timemap.shutdownRoutine.minutes}
              className="field"
            />
          </label>
          <div className="sm:col-span-4">
            <button type="submit" className="btn-primary w-full text-xs">
              Save routines
            </button>
          </div>
        </form>
      </section>

      {allocation.metrics.overcommitted ? (
        <Overcommitted
          neededMin={allocation.metrics.overcommitted.neededMin}
          availableMin={allocation.metrics.overcommitted.availableMin}
          mode={allocation.metrics.overcommitted.mode}
        />
      ) : null}

      <ResizableColumns
        left={
          <div className="flex flex-col gap-5">
            <PlanClient
              initialGoals={plan.goals}
              freeMinutesThisWeek={allocation.metrics.utilisation.availableMinutes}
              wheelAreas={settings.wheel.areas.map((a) => ({ id: a.id, label: a.label }))}
              scheduledByGoal={scheduledByGoal}
              effectiveTargetByGoal={effectiveTargetByGoal}
            />

            {allocation.metrics.notScheduled.length > 0 && (
              <section className="card border-amber-300/40">
                <h2 className="text-sm font-semibold">Not scheduled this week</h2>
                <p className="text-xs text-ink-400">
                  With strict mode on, these goals didn&apos;t fit. Either soften their floors or
                  switch to proportional in Constraints.
                </p>
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {allocation.metrics.notScheduled.map((n) => (
                    <li key={n.goalId}>{n.title}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        }
        right={
          <>
            {/*
              On large screens this column becomes a sticky right rail so the
              calendar stays visible while the goals list scrolls. On small
              screens it stacks below the goals as a collapsible details block.
            */}
            <div className="lg:sticky lg:top-6 lg:self-start">
              <div className="hidden lg:block">
                <CalendarPreview
                  weekStartMs={weekStartMs}
                  timezone={settings.timezone}
                  busy={busyForCalendar}
                  system={systemBlocksForCalendar}
                  proposed={proposedForCalendar}
                  compact
                />
              </div>
              <details className="card lg:hidden" open>
                <summary className="cursor-pointer text-sm font-semibold">Preview this week</summary>
                <div className="mt-3">
                  <RangeToggleCalendar
                    weekStartMs={weekStartMs}
                    timezone={settings.timezone}
                    busy={busyForCalendar}
                    system={systemBlocksForCalendar}
                    proposed={proposedForCalendar}
                  />
                </div>
              </details>
            </div>
          </>
        }
      />
    </div>
  );
}

function CalendarPreview({
  weekStartMs,
  timezone,
  busy,
  system,
  proposed,
  compact
}: {
  weekStartMs: number;
  timezone: string;
  busy: Parameters<typeof WeekCalendar>[0]["busy"];
  system: Parameters<typeof WeekCalendar>[0]["system"];
  proposed: Parameters<typeof WeekCalendar>[0]["proposed"];
  compact: boolean;
}) {
  return (
    <RangeToggleCalendar
      weekStartMs={weekStartMs}
      timezone={timezone}
      busy={busy}
      system={system ?? []}
      proposed={proposed}
      compact={compact}
    />
  );
}

function Overcommitted({
  neededMin,
  availableMin,
  mode
}: {
  neededMin: number;
  availableMin: number;
  mode: "proportional" | "strict";
}) {
  const trimPercent = Math.max(0, Math.round(((neededMin - availableMin) / neededMin) * 100));
  return (
    <section className="card border-amber-300/40 bg-amber-50/30 dark:bg-amber-900/10">
      <div className="text-sm font-semibold">You&apos;re overcommitted</div>
      <p className="mt-1 text-xs text-ink-600 dark:text-ink-200">
        Your minimums need {Math.round(neededMin / 60)}h but only {Math.round(availableMin / 60)}h
        are free.{" "}
        {mode === "proportional"
          ? `Every goal is being trimmed by ~${trimPercent}%.`
          : "Floors are being paid in order; later goals may be skipped this week."}
      </p>
    </section>
  );
}
