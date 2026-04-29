import { revalidatePath } from "next/cache";
import { authOrPreview } from "@/lib/auth";
import { loadSettings, saveSettings } from "@/lib/settings-store";
import {
  coerceSettingsAfterLegacyWheelPpfHppEdit,
  type Hp6HabitKey,
  type PpfPillarKey
} from "@calendar-automations/schema";

const PILLARS: PpfPillarKey[] = ["personal", "professional", "financial"];
const HP6: { key: Hp6HabitKey; label: string }[] = [
  { key: "clarity", label: "Seek clarity" },
  { key: "energy", label: "Generate energy" },
  { key: "necessity", label: "Raise necessity" },
  { key: "productivity", label: "Increase productivity" },
  { key: "influence", label: "Develop influence" },
  { key: "courage", label: "Demonstrate courage" }
];

function revalidatePlanningSurfaces() {
  revalidatePath("/dashboard/energy");
  revalidatePath("/dashboard/plan");
}

async function updateWheel(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const areas = settings.wheel.areas.map((a) => {
    const score = Number(formData.get(`score_${a.id}`) ?? a.score);
    const minMinutes = Number(formData.get(`floor_${a.id}`) ?? a.minMinutesPerWeek);
    return {
      ...a,
      score: Math.max(1, Math.min(10, score || a.score)),
      minMinutesPerWeek: Math.max(0, Math.floor(minMinutes || 0))
    };
  });
  await saveSettings(
    userId,
    coerceSettingsAfterLegacyWheelPpfHppEdit({
      ...settings,
      wheel: { ...settings.wheel, enabled: true, areas }
    })
  );
  revalidatePlanningSurfaces();
}

async function updatePpf(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const targets = PILLARS.map((p) => ({
    pillar: p,
    minPercent: Math.max(0, Math.min(100, Number(formData.get(`pct_${p}`) ?? 0))),
    minTouchesPerWeek: Math.max(0, Number(formData.get(`touches_${p}`) ?? 0))
  }));
  await saveSettings(
    userId,
    coerceSettingsAfterLegacyWheelPpfHppEdit({
      ...settings,
      ppf: { enabled: true, targets }
    })
  );
  revalidatePlanningSurfaces();
}

async function updateHpp(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const hp6MinTouchesPerMonth = Object.fromEntries(
    HP6.map((h) => [h.key, Math.max(0, Number(formData.get(`hp6_${h.key}`) ?? 0))])
  ) as Record<Hp6HabitKey, number>;
  await saveSettings(
    userId,
    coerceSettingsAfterLegacyWheelPpfHppEdit({
      ...settings,
      hpp: {
        ...settings.hpp,
        enabled: true,
        hp6MinTouchesPerMonth
      }
    })
  );
  revalidatePlanningSurfaces();
}

async function updateEnergy(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const mode = String(formData.get("mode") ?? "balanced") as "strict" | "balanced" | "ignore";
  await saveSettings(userId, {
    ...settings,
    energyOrdering: { ...settings.energyOrdering, mode }
  });
  revalidatePlanningSurfaces();
}

async function updateAllocator(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const starvationMode = (String(formData.get("starvationMode") ?? "proportional") === "strict"
    ? "strict"
    : "proportional") as "proportional" | "strict";
  await saveSettings(userId, {
    ...settings,
    allocator: { ...settings.allocator, starvationMode }
  });
  revalidatePlanningSurfaces();
}

async function updateAllocationMode(formData: FormData): Promise<void> {
  "use server";
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const allocationMode = (String(formData.get("allocationMode") ?? "even") === "finish-early"
    ? "finish-early"
    : "even") as "even" | "finish-early";
  await saveSettings(userId, {
    ...settings,
    allocator: { ...settings.allocator, allocationMode }
  });
  revalidatePlanningSurfaces();
}

export async function ConstraintsSection() {
  const session = await authOrPreview();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);

  return (
    <div id="scheduling-constraints" className="scroll-mt-6 flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-semibold">Scheduling rules</h2>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          Optional rules that shape how your perfect week gets scheduled. Each section is
          independent; collapse what you don&apos;t need. Morning and shutdown routines live on{" "}
          <a className="underline" href="/dashboard/plan">
            My Perfect Week
          </a>
          .
        </p>
      </header>

      <details className="card" open>
        <summary className="cursor-pointer text-sm font-semibold">Spare time distribution</summary>
        <p className="mt-1 text-xs text-ink-400">
          After your weekly minimums are covered, how should spare time affect targets and how the
          week is packed on the calendar?
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
              <strong>Evenly distributed</strong> — fair weekly targets above your floors, and
              leftover slack inside each free window is opened up as equal spacing between goal
              blocks (not one tail of empty time).
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
              <strong>Finish early</strong> — fill goals one after another in order; leftover time
              accumulates as free time at the end.
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

      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold">Energy ordering</summary>
        <p className="mt-1 text-xs text-ink-400">
          Lay deep-focus goals before scanning ones, matching your daily energy curve.
        </p>
        <form action={updateEnergy} className="mt-3 flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs">
            Mode
            <select name="mode" className="field" defaultValue={settings.energyOrdering.mode}>
              <option value="strict">Strict — refuse scanning before warm-up</option>
              <option value="balanced">Balanced — prefer the curve</option>
              <option value="ignore">Ignore — purely chronological</option>
            </select>
          </label>
          <button className="btn-primary text-xs" type="submit">
            Save
          </button>
        </form>
      </details>

      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold">Wheel of Life</summary>
        <p className="mt-1 text-xs text-ink-400">
          Areas of life that should each get some weekly time. Set a floor so neglected ones
          always get scheduled.
        </p>
        <form action={updateWheel} className="mt-3 grid gap-3 sm:grid-cols-2">
          {settings.wheel.areas.map((a) => (
            <fieldset key={a.id} className="rounded border border-ink-200 p-2 dark:border-ink-600">
              <legend className="text-xs font-medium">{a.label}</legend>
              <label className="flex flex-col gap-1 text-xs">
                Score (1–10)
                <input
                  name={`score_${a.id}`}
                  type="number"
                  min={1}
                  max={10}
                  defaultValue={a.score}
                  className="field"
                />
              </label>
              <label className="mt-2 flex flex-col gap-1 text-xs">
                Min minutes / week
                <input
                  name={`floor_${a.id}`}
                  type="number"
                  min={0}
                  step={15}
                  defaultValue={a.minMinutesPerWeek}
                  className="field"
                />
              </label>
            </fieldset>
          ))}
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary w-full text-xs">
              Save Wheel
            </button>
          </div>
        </form>
      </details>

      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold">
          Personal / Professional / Financial mix
        </summary>
        <p className="mt-1 text-xs text-ink-400">
          Set minimum percent of allocated time per pillar and minimum touches per week.
        </p>
        <form action={updatePpf} className="mt-3 grid gap-3 sm:grid-cols-3">
          {PILLARS.map((p) => {
            const target = settings.ppf.targets.find((t) => t.pillar === p);
            return (
              <fieldset key={p} className="rounded border border-ink-200 p-2 dark:border-ink-600">
                <legend className="text-xs font-medium capitalize">{p}</legend>
                <label className="flex flex-col gap-1 text-xs">
                  Min % of week
                  <input
                    name={`pct_${p}`}
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={target?.minPercent ?? 0}
                    className="field"
                  />
                </label>
                <label className="mt-2 flex flex-col gap-1 text-xs">
                  Min touches / week
                  <input
                    name={`touches_${p}`}
                    type="number"
                    min={0}
                    defaultValue={target?.minTouchesPerWeek ?? 0}
                    className="field"
                  />
                </label>
              </fieldset>
            );
          })}
          <div className="sm:col-span-3">
            <button type="submit" className="btn-primary w-full text-xs">
              Save mix
            </button>
          </div>
        </form>
      </details>

      <details className="card">
        <summary className="cursor-pointer text-sm font-semibold">High-performance habits (HP6)</summary>
        <p className="mt-1 text-xs text-ink-400">
          Tag goals with a habit and we&apos;ll ensure each habit hits its minimum touches per
          month.
        </p>
        <form action={updateHpp} className="mt-3 grid gap-3 sm:grid-cols-2">
          {HP6.map((h) => (
            <label key={h.key} className="flex flex-col gap-1 text-xs">
              {h.label}
              <input
                name={`hp6_${h.key}`}
                type="number"
                min={0}
                defaultValue={settings.hpp.hp6MinTouchesPerMonth[h.key] ?? 0}
                className="field"
              />
            </label>
          ))}
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary w-full text-xs">
              Save habits
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
