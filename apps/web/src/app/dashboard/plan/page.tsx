import { eq } from "drizzle-orm";
import { type WeeklyPlan } from "@calendar-automations/schema";
import { allocateWeek } from "@calendar-automations/planner";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { loadSettings } from "@/lib/settings-store";
import { fetchGoogleBusy } from "@/lib/google-calendar";
import { localMondayIso, localMondayMidnightMs } from "@/lib/week";
import { computeSystemBlocks } from "@/lib/week-blocks";
import { PlanClient } from "./plan-client";
import { ResizableColumns } from "./resizable-columns";
import { WeekCalendar } from "../week-calendar";
import { RangeToggleCalendar } from "./range-toggle-calendar";

export const dynamic = "force-dynamic";

async function loadPlan(userId: string, timezone: string): Promise<WeeklyPlan> {
  const weekStart = localMondayIso(timezone);
  if (!db) {
    return { id: "dev", weekStart, timezone, goals: [] };
  }
  const rows = await db
    .select()
    .from(schema.weeklyPlans)
    .where(eq(schema.weeklyPlans.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { id: crypto.randomUUID(), weekStart, timezone, goals: [] };
  }
  const stored = row.data as WeeklyPlan;
  return { ...stored, id: row.id, weekStart, timezone };
}

export default async function PlanPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);
  const plan = await loadPlan(userId, settings.timezone);

  const weekStartMs = localMondayMidnightMs(settings.timezone);
  const weekEndMs = weekStartMs + 7 * 24 * 60 * 60 * 1000;
  const busy = await fetchGoogleBusy(
    userId,
    settings.calendars.sources,
    weekStartMs,
    weekEndMs
  ).catch(() => []);
  // System blocks (sleep + travel) reserve time around real events. They're
  // merged into the busy stream so goals don't land on top of them, and
  // surfaced separately to the calendar for distinct visual styling.
  const systemBlocks = computeSystemBlocks(
    weekStartMs,
    busy,
    settings.sleep,
    settings.travel,
    settings.timezone,
    settings.timemap
  );
  const allocation = allocateWeek({
    plan,
    busy: [...busy, ...systemBlocks],
    settings,
    weekStartMs,
    weekEndMs
  });

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
                  busy={busy}
                  system={systemBlocks}
                  proposed={allocation.blocks}
                  compact
                />
              </div>
              <details className="card lg:hidden" open>
                <summary className="cursor-pointer text-sm font-semibold">Preview this week</summary>
                <div className="mt-3">
                  <RangeToggleCalendar
                    weekStartMs={weekStartMs}
                    timezone={settings.timezone}
                    busy={busy}
                    system={systemBlocks}
                    proposed={allocation.blocks}
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
