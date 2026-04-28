import Link from "next/link";
import { eq } from "drizzle-orm";
import { type WeeklyPlan } from "@calendar-automations/schema";
import { allocateWeek } from "@calendar-automations/planner";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { loadSettings } from "@/lib/settings-store";
import { loadLatestSnapshot } from "@/lib/snapshots";
import { fetchGoogleBusy } from "@/lib/google-calendar";
import { localMondayIso, localMondayMidnightMs } from "@/lib/week";
import { formatMinutes } from "./plan/goal-helpers";
import { WeekCalendar } from "./week-calendar";

export const dynamic = "force-dynamic";

async function loadPlan(userId: string, timezone: string): Promise<WeeklyPlan> {
  const weekStart = localMondayIso(timezone);
  if (!db) return { id: "dev", weekStart, timezone, goals: [] };
  const rows = await db
    .select()
    .from(schema.weeklyPlans)
    .where(eq(schema.weeklyPlans.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return { id: crypto.randomUUID(), weekStart, timezone, goals: [] };
  const stored = row.data as WeeklyPlan;
  return { ...stored, id: row.id, weekStart, timezone };
}

export default async function DashboardHome() {
  const session = await auth();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);
  const [plan, snapshot] = await Promise.all([
    loadPlan(userId, settings.timezone),
    loadLatestSnapshot(userId)
  ]);
  const planWithTz: WeeklyPlan = { ...plan, timezone: settings.timezone };

  const weekStartMs = localMondayMidnightMs(settings.timezone);
  const weekEndMs = weekStartMs + 7 * 24 * 60 * 60 * 1000;
  const busy = await fetchGoogleBusy(
    userId,
    settings.calendars.sources,
    weekStartMs,
    weekEndMs
  ).catch(() => []);
  const allocation = allocateWeek({
    plan: planWithTz,
    busy,
    settings,
    weekStartMs,
    weekEndMs
  });

  const calendarsConnected = settings.calendars.sources.length > 0;
  const goalsCount = planWithTz.goals.length;
  const scheduledMin = allocation.metrics.utilisation.scheduledMinutes;
  const targetMin = Object.values(allocation.metrics.perGoal).reduce(
    (acc, m) => acc + m.targetMinutes,
    0
  );
  const progress = targetMin > 0 ? Math.min(100, Math.round((scheduledMin / targetMin) * 100)) : 0;

  // Pull the next 3 events that haven't ended yet.
  const now = Date.now();
  const upcoming = (snapshot?.events ?? [])
    .filter((e) => e.endMs > now)
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, 3);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">Today</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          A snapshot of how this week is shaping up against your perfect week.
        </p>
      </header>

      {goalsCount === 0 ? (
        <FirstRunCallout calendarsConnected={calendarsConnected} />
      ) : (
        <ThisWeekHero
          progressPercent={progress}
          scheduledMin={scheduledMin}
          targetMin={targetMin}
          freeMin={allocation.metrics.utilisation.availableMinutes}
          goalsCount={goalsCount}
          overcommitted={allocation.metrics.overcommitted ?? null}
        />
      )}

      {(busy.length > 0 || allocation.blocks.length > 0) && (
        <WeekCalendar
          weekStartMs={weekStartMs}
          timezone={settings.timezone}
          busy={busy}
          proposed={allocation.blocks}
        />
      )}

      <UpNext upcoming={upcoming} />

      <section className="card flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/plan" className="btn-primary">
            Edit my Perfect Week
          </Link>
          {!calendarsConnected && (
            <Link href="/dashboard/calendars" className="btn-secondary">
              Connect a calendar
            </Link>
          )}
          <Link href="/dashboard/feeds" className="btn-secondary">
            Get iCal URL
          </Link>
        </div>
      </section>
    </div>
  );
}

function ThisWeekHero({
  progressPercent,
  scheduledMin,
  targetMin,
  freeMin,
  goalsCount,
  overcommitted
}: {
  progressPercent: number;
  scheduledMin: number;
  targetMin: number;
  freeMin: number;
  goalsCount: number;
  overcommitted: { neededMin: number; availableMin: number } | null;
}) {
  return (
    <section className="card flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">This week vs your perfect week</h2>
        <span className="text-xs text-ink-400">
          {goalsCount} {goalsCount === 1 ? "goal" : "goals"}
        </span>
      </div>
      <div>
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">
            {formatMinutes(scheduledMin)} scheduled
          </span>
          <span className="text-ink-400">
            of {formatMinutes(targetMin)} target
          </span>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-600/40"
          aria-label={`${progressPercent}% of target scheduled`}
        >
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
      <div className="grid gap-1 text-xs text-ink-400 sm:grid-cols-2">
        <div>{formatMinutes(freeMin)} free time across the week</div>
        {overcommitted ? (
          <div className="text-amber-600 dark:text-amber-300">
            Overcommitted by {formatMinutes(overcommitted.neededMin - overcommitted.availableMin)}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function UpNext({
  upcoming
}: {
  upcoming: Array<{ uid: string; title: string; startMs: number; endMs: number }>;
}) {
  if (upcoming.length === 0) {
    return (
      <section className="card">
        <h2 className="text-sm font-semibold">What&apos;s next</h2>
        <p className="mt-1 text-xs text-ink-400">
          No upcoming generated events yet. Add goals and connect a calendar to see them here.
        </p>
      </section>
    );
  }
  return (
    <section className="card">
      <h2 className="text-sm font-semibold">What&apos;s next</h2>
      <ul className="mt-2 flex flex-col gap-2">
        {upcoming.map((e) => (
          <li
            key={e.uid}
            className="flex items-center justify-between gap-3 border-b border-ink-100 pb-2 last:border-0 last:pb-0 dark:border-ink-600/40"
          >
            <div className="text-sm font-medium">{e.title}</div>
            <div className="text-xs text-ink-400">
              {new Date(e.startMs).toLocaleString(undefined, {
                weekday: "short",
                hour: "2-digit",
                minute: "2-digit"
              })}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FirstRunCallout({ calendarsConnected }: { calendarsConnected: boolean }) {
  return (
    <section className="card flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Welcome — let&apos;s build your week</h2>
      <p className="text-sm text-ink-600 dark:text-ink-200">
        Add a few things you want every week (deep work, exercise, family time) and we&apos;ll find
        the time around your existing calendar.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Link href="/dashboard/plan" className="btn-primary text-xs">
          Build my Perfect Week
        </Link>
        {!calendarsConnected && (
          <Link href="/dashboard/calendars" className="btn-secondary text-xs">
            Connect a calendar first
          </Link>
        )}
      </div>
    </section>
  );
}
