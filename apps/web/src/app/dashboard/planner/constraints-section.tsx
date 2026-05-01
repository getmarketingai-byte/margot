import { authOrPreview } from "@/lib/auth";
import { invalidateUserAllocationCache } from "@/lib/cached-plan-week-allocation-inputs";
import { revalidatePlanningRoutes } from "@/lib/dashboard-revalidate";
import { loadSettings, saveSettings } from "@/lib/settings-store";
import type { UserSettings } from "@calendar-automations/schema";
import { PhysicalActivityRoutineForm } from "./physical-activity-routine-form";
import { WeeklyErrandsRoutineForm } from "./weekly-errands-routine-form";

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
          Global allocator mechanics: daily routines, catch-up from day sheet, spare-time layout,
          starvation when you&apos;re overcommitted. Framework tagging, floors, PPF mix, HP6 touches, and
          energy ordering curves are tuned in{" "}
          <a className="underline" href="#framework-methods-heading">
            Framework rule customiser
          </a>
          .
        </p>
      </header>

      <details className="card" open>
        <summary className="cursor-pointer text-sm font-semibold">Daily routines</summary>
        <p className="mt-1 text-xs text-ink-400">
          Morning and shutdown routines are reserved around sleep and block planner time-map slots
          from being placed in the same window.
        </p>
        <form action={updateRoutines} className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-3">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                name="morning_enabled"
                defaultChecked={settings.timemap.morningRoutine.enabled}
              />
              <span>Enable morning routine</span>
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs">
              Morning minutes
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
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                name="shutdown_enabled"
                defaultChecked={settings.timemap.shutdownRoutine.enabled}
              />
              <span>Enable shutdown routine</span>
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs">
              Shutdown minutes
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
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary w-full text-xs">
              Save routines
            </button>
          </div>
        </form>
        <PhysicalActivityRoutineForm initial={settings.gym} />
        <WeeklyErrandsRoutineForm initial={settings.weeklyErrands} />
      </details>

      <details className="card" open>
        <summary className="cursor-pointer text-sm font-semibold">Catch-up from day sheet</summary>
        <p className="mt-1 text-xs text-ink-400">
          Whether behind-pace floors come from your day logs automatically or only after you save
          numbers on the week review.
        </p>
        <form action={updateCatchUpMode} className="mt-3 flex flex-col gap-2 text-sm">
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
          <button type="submit" className="btn-primary w-fit text-xs">
            Save
          </button>
        </form>
      </details>

      <details className="card" open>
        <summary className="cursor-pointer text-sm font-semibold">Spare time distribution</summary>
        <p className="mt-1 text-xs text-ink-400">
          How should leftover time <em>inside each free calendar window</em> be laid out after goal
          blocks are placed? This does not change how long each goal block is — only spacing vs a
          single tail of empty time in that window.
        </p>
        <form action={updateAllocationMode} className="mt-3 flex flex-col gap-2 text-sm">
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
              <strong>Finish early</strong> — goal blocks stay back-to-back; unallocated time in that
              window is grouped as free time at the end of the window.
            </span>
          </label>
          <button type="submit" className="btn-primary w-fit text-xs">
            Save
          </button>
        </form>
      </details>

      <details className="card" open>
        <summary className="cursor-pointer text-sm font-semibold">When you&apos;re overcommitted</summary>
        <p className="mt-1 text-xs text-ink-400">
          What should happen when your goal minimums add up to more time than you actually have?
        </p>
        <form action={updateAllocator} className="mt-3 flex flex-col gap-2 text-sm">
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
          <button type="submit" className="btn-primary w-fit text-xs">
            Save
          </button>
        </form>
      </details>
    </div>
  );
}
