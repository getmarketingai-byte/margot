import { ConstraintCard } from "@/components/scheduling-constraints";
import { authOrPreview } from "@/lib/auth";
import { invalidateUserAllocationCache } from "@/lib/cached-plan-week-allocation-inputs";
import { revalidatePlanningRoutes } from "@/lib/dashboard-revalidate";
import { loadSettings, saveSettings } from "@/lib/settings-store";
import type { UserSettings } from "@calendar-automations/schema";

function afterConstraintsSave(userId: string): void {
  invalidateUserAllocationCache(userId);
  revalidatePlanningRoutes();
}

async function updateAllocator(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const starvationMode = (String(formData.get("starvationMode") ?? "proportional") === "strict"
    ? "strict"
    : "proportional") as UserSettings["allocator"]["starvationMode"];
  await saveSettings(userId, {
    ...settings,
    allocator: { ...settings.allocator, starvationMode }
  });
  afterConstraintsSave(userId);
}

async function updateGoalWindowMode(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const raw = String(formData.get("goalWindowMode") ?? "linear");
  const goalWindowMode = (
    raw === "stacked" ? "stacked" : raw === "hybrid" ? "hybrid" : "linear"
  ) as UserSettings["allocator"]["goalWindowMode"];
  await saveSettings(userId, {
    ...settings,
    allocator: { ...settings.allocator, goalWindowMode }
  });
  afterConstraintsSave(userId);
}

async function updateAllocationMode(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const allocationMode = (String(formData.get("allocationMode") ?? "even") === "finish-early"
    ? "finish-early"
    : "even") as UserSettings["allocator"]["allocationMode"];
  await saveSettings(userId, {
    ...settings,
    allocator: { ...settings.allocator, allocationMode }
  });
  afterConstraintsSave(userId);
}

async function updateCatchUpMode(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const catchUpMode = (String(formData.get("catchUpMode") ?? "automated") === "manual"
    ? "manual"
    : "automated") as UserSettings["allocator"]["catchUpMode"];
  await saveSettings(userId, {
    ...settings,
    allocator: { ...settings.allocator, catchUpMode }
  });
  afterConstraintsSave(userId);
}

async function updateRoutines(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
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

  afterConstraintsSave(userId);
}

async function updateGymPlannerBlockFallback(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const plannerBlockEnabled = formData.get("planner_block_enabled") === "on";
  await saveSettings(userId, {
    ...settings,
    gym: { ...settings.gym, plannerBlockEnabled }
  });
  afterConstraintsSave(userId);
}

function routineDisclosureSummary(settings: UserSettings): string {
  const m = settings.timemap.morningRoutine;
  const s = settings.timemap.shutdownRoutine;
  const mPart = m.enabled ? `${m.minutes}m` : "off";
  const sPart = s.enabled ? `${s.minutes}m` : "off";
  const gymFb = settings.gym.plannerBlockEnabled ? " · Gym fallback on" : "";
  return `Morning ${mPart} · Shutdown ${sPart}${gymFb}`;
}

function catchUpDisclosureSummary(settings: UserSettings): string {
  return settings.allocator.catchUpMode === "manual" ? "Manual (week review only)" : "Automated (from day sheet)";
}

function allocationModeDisclosureSummary(settings: UserSettings): string {
  return settings.allocator.allocationMode === "finish-early"
    ? "Finish early (tail gap)"
    : "Even gaps between blocks";
}

function goalWindowModeDisclosureSummary(settings: UserSettings): string {
  const m = settings.allocator.goalWindowMode;
  if (m === "stacked") return "Stacked envelopes (external scheduler)";
  if (m === "hybrid") return "Hybrid — per goal on Perfect Week";
  return "Linear blocks (in-app)";
}

function starvationDisclosureSummary(settings: UserSettings): string {
  return settings.allocator.starvationMode === "strict"
    ? "Strict (goal order)"
    : "Proportional (trim all)";
}

export async function ConstraintsSection() {
  const session = await authOrPreview();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);

  return (
    <div id="scheduling-outcomes" className="scroll-mt-6 flex flex-col gap-4">
      <header>
        <h2 id="scheduling-outcomes-heading" className="text-lg font-semibold">
          Scheduling options
        </h2>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          Routines and global allocator behaviour. Numeric framework rules are under{" "}
          <a className="underline" href="#framework-methods-heading">
            Rules
          </a>
          .
        </p>
      </header>

      <details className="card">
        <summary className="flex cursor-pointer list-none flex-col gap-0.5 py-0.5 [&::-webkit-details-marker]:hidden sm:flex-row sm:items-baseline sm:gap-2">
          <span className="text-sm font-semibold">Daily routines</span>
          <span className="text-xs font-normal text-ink-500 dark:text-ink-400">
            {routineDisclosureSummary(settings)}
          </span>
        </summary>
        <p className="mt-1 text-xs text-ink-400">
          Morning and shutdown routines reserve windows around sleep.
        </p>
        <form action={updateRoutines} className="mt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <ConstraintCard label="Morning routine">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  name="morning_enabled"
                  defaultChecked={settings.timemap.morningRoutine.enabled}
                />
                <span>Enable</span>
              </label>
              <label className="mt-2 flex min-w-0 flex-col gap-1 text-xs">
                Minutes
                <input
                  type="number"
                  name="morning_minutes"
                  min={0}
                  max={180}
                  step={5}
                  defaultValue={settings.timemap.morningRoutine.minutes}
                  className="field w-full"
                />
              </label>
            </ConstraintCard>
            <ConstraintCard label="Shutdown routine">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  name="shutdown_enabled"
                  defaultChecked={settings.timemap.shutdownRoutine.enabled}
                />
                <span>Enable</span>
              </label>
              <label className="mt-2 flex min-w-0 flex-col gap-1 text-xs">
                Minutes
                <input
                  type="number"
                  name="shutdown_minutes"
                  min={0}
                  max={180}
                  step={5}
                  defaultValue={settings.timemap.shutdownRoutine.minutes}
                  className="field w-full"
                />
              </label>
            </ConstraintCard>
            <div className="sm:col-span-2">
              <button type="submit" className="btn-primary w-full text-xs">
                Save morning / shutdown
              </button>
            </div>
          </div>
        </form>
        <form action={updateGymPlannerBlockFallback} className="mt-3 border-t border-ink-200 pt-3 dark:border-ink-600">
          <ConstraintCard label="Physical activity (Perfect Week vs legacy fallback)">
            <p className="text-xs text-ink-400">
              Weekly physical activity is a{" "}
              <a className="underline" href="/dashboard/plan">
                Perfect Week
              </a>{" "}
              goal row (gym preset: drive padding, same constraint UI and list order as other goals).
              The toggle below is the old &quot;Plan weekly physical activity block&quot; switch: when
              it is on and you have no gym row on Perfect Week, the planner injects a legacy synthetic
              block from these gym settings.
            </p>
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs">
              <input
                type="checkbox"
                name="planner_block_enabled"
                value="on"
                defaultChecked={settings.gym.plannerBlockEnabled}
                className="mt-0.5"
              />
              <span>
                Enable legacy synthetic block when there is no gym row on Perfect Week (uses gym
                cadence / windows from settings).
              </span>
            </label>
            <button type="submit" className="btn-primary mt-3 text-xs">
              Save physical activity fallback
            </button>
          </ConstraintCard>
        </form>
      </details>

      <details className="card">
        <summary className="flex cursor-pointer list-none flex-col gap-0.5 py-0.5 [&::-webkit-details-marker]:hidden sm:flex-row sm:items-baseline sm:gap-2">
          <span className="text-sm font-semibold">Catch-up from day sheet</span>
          <span className="text-xs font-normal text-ink-500 dark:text-ink-400">
            {catchUpDisclosureSummary(settings)}
          </span>
        </summary>
        <p className="mt-1 text-xs text-ink-400">
          Whether behind-pace floors come from your day logs automatically or only after you save
          numbers on the week review.
        </p>
        <form action={updateCatchUpMode} className="mt-3">
          <ConstraintCard label="Catch-up mode">
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="catchUpMode"
                  value="automated"
                  defaultChecked={settings.allocator.catchUpMode !== "manual"}
                  className="mt-1"
                />
                <span>
                  <strong>Automated (default)</strong> — derive extra weekly floors from day-sheet pace
                  vs a baseline allocation; Perfect Week updates without clicking Apply.
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="catchUpMode"
                  value="manual"
                  defaultChecked={settings.allocator.catchUpMode === "manual"}
                  className="mt-1"
                />
                <span>
                  <strong>Manual</strong> — floors only from values you apply on the week review.
                  Stored adjustments are ignored by the allocator while automated mode is on.
                </span>
              </label>
              <button type="submit" className="btn-primary mt-1 w-fit text-xs">
                Save
              </button>
            </div>
          </ConstraintCard>
        </form>
      </details>

      <details className="card">
        <summary className="flex cursor-pointer list-none flex-col gap-0.5 py-0.5 [&::-webkit-details-marker]:hidden sm:flex-row sm:items-baseline sm:gap-2">
          <span className="text-sm font-semibold">Perfect Week placement style</span>
          <span className="text-xs font-normal text-ink-500 dark:text-ink-400">
            {goalWindowModeDisclosureSummary(settings)}
          </span>
        </summary>
        <p className="mt-1 text-xs text-ink-400">
          Linear mode greedy-packs concrete goal blocks into free calendar time. Stacked mode skips
          auto blocks and ignores saved goal overrides from linear placement (drag/day-sheet pins), then
          computes per-goal <strong>feasible time unions</strong> for tools like Skedpal — weekly targets
          from Pass 1+2 stay the same; unplaced minutes mean duration is owned outside this planner until
          you hook up export. <strong>Hybrid</strong> defaults each Perfect Week goal to stacked (same as
          Skedpal-first); opt specific rows into linear greedy packing on{" "}
          <a className="underline" href="/dashboard/plan">
            Perfect Week
          </a>
          . On each <strong>linear-role</strong> row, answer whether that goal blocks stacked time maps for the week.
        </p>
        <form action={updateGoalWindowMode} className="mt-3">
          <ConstraintCard label="Goal windows">
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="goalWindowMode"
                  value="linear"
                  defaultChecked={
                    settings.allocator.goalWindowMode !== "stacked" &&
                    settings.allocator.goalWindowMode !== "hybrid"
                  }
                  className="mt-1"
                />
                <span>
                  <strong>Linear (default)</strong> — place scheduled blocks each week inside your
                  constraints.
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="goalWindowMode"
                  value="stacked"
                  defaultChecked={settings.allocator.goalWindowMode === "stacked"}
                  className="mt-1"
                />
                <span>
                  <strong>Stacked timemap</strong> — emit where each goal <em>may</em> run (maximum
                  envelope from calendar gaps + goal rules); Perfect Week ignores linear-mode goal pins on
                  the preview; hand duration packing to your external scheduler.
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="goalWindowMode"
                  value="hybrid"
                  defaultChecked={settings.allocator.goalWindowMode === "hybrid"}
                  className="mt-1"
                />
                <span>
                  <strong>Hybrid</strong> — mix linear and stacked per goal on Perfect Week (default per
                  goal: stacked). Set placement and ribbon behaviour on each expanded goal row.
                </span>
              </label>
              <button type="submit" className="btn-primary mt-1 w-fit text-xs">
                Save
              </button>
            </div>
          </ConstraintCard>
        </form>
      </details>

      <details className="card">
        <summary className="flex cursor-pointer list-none flex-col gap-0.5 py-0.5 [&::-webkit-details-marker]:hidden sm:flex-row sm:items-baseline sm:gap-2">
          <span className="text-sm font-semibold">Spare time distribution</span>
          <span className="text-xs font-normal text-ink-500 dark:text-ink-400">
            {allocationModeDisclosureSummary(settings)}
          </span>
        </summary>
        <p className="mt-1 text-xs text-ink-400">
          How should leftover time <em>inside each free calendar window</em> be laid out after goal
          blocks are placed? This does not change how long each goal block is — only spacing vs a
          single tail of empty time in that window.
        </p>
        <form action={updateAllocationMode} className="mt-3">
          <ConstraintCard label="Layout inside free windows">
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="allocationMode"
                  value="even"
                  defaultChecked={settings.allocator.allocationMode !== "finish-early"}
                  className="mt-1"
                />
                <span>
                  <strong>Evenly distributed</strong> — split unallocated time in the window into equal
                  gaps between consecutive goal blocks (breathing room), instead of one block of empty
                  time at the end.
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="allocationMode"
                  value="finish-early"
                  defaultChecked={settings.allocator.allocationMode === "finish-early"}
                  className="mt-1"
                />
                <span>
                  <strong>Finish early</strong> — goal blocks stay back-to-back; unallocated time in
                  that window is grouped as free time at the end of the window.
                </span>
              </label>
              <button type="submit" className="btn-primary mt-1 w-fit text-xs">
                Save
              </button>
            </div>
          </ConstraintCard>
        </form>
      </details>

      <details className="card">
        <summary className="flex cursor-pointer list-none flex-col gap-0.5 py-0.5 [&::-webkit-details-marker]:hidden sm:flex-row sm:items-baseline sm:gap-2">
          <span className="text-sm font-semibold">When you&apos;re overcommitted</span>
          <span className="text-xs font-normal text-ink-500 dark:text-ink-400">
            {starvationDisclosureSummary(settings)}
          </span>
        </summary>
        <p className="mt-1 text-xs text-ink-400">
          What should happen when your goal minimums add up to more time than you actually have?
        </p>
        <form action={updateAllocator} className="mt-3">
          <ConstraintCard label="Starvation mode">
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="starvationMode"
                  value="proportional"
                  defaultChecked={settings.allocator.starvationMode !== "strict"}
                  className="mt-1"
                />
                <span>
                  <strong>Proportional</strong> — every goal trims a bit so each still gets a fair
                  share.
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="starvationMode"
                  value="strict"
                  defaultChecked={settings.allocator.starvationMode === "strict"}
                  className="mt-1"
                />
                <span>
                  <strong>Strict</strong> — pay floors in goal order until time runs out, leaving
                  later goals unscheduled.
                </span>
              </label>
              <button type="submit" className="btn-primary mt-1 w-fit text-xs">
                Save
              </button>
            </div>
          </ConstraintCard>
        </form>
      </details>
    </div>
  );
}
