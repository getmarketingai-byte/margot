import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import {
  type WeeklyPlan,
  type WeeklyGoal,
  type EnergyMode,
  type DayOfWeek
} from "@calendar-automations/schema";
import { allocateWeek } from "@calendar-automations/planner";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { loadSettings } from "@/lib/settings-store";
import { fetchGoogleBusy } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

function thisMondayIso(timezone: string): string {
  // Compute Monday in user TZ; we rely on the timezone string but use a UTC-anchored
  // approximation here — the planner re-derives day boundaries.
  const now = new Date();
  const dow = (now.getUTCDay() + 6) % 7;
  const mon = new Date(now.getTime() - dow * 24 * 60 * 60 * 1000);
  void timezone;
  return mon.toISOString().slice(0, 10);
}

async function loadOrCreatePlan(userId: string, timezone: string): Promise<WeeklyPlan> {
  const weekStart = thisMondayIso(timezone);
  if (!db) {
    return { id: "dev", weekStart, timezone, goals: [] };
  }
  const rows = await db
    .select()
    .from(schema.weeklyPlans)
    .where(eq(schema.weeklyPlans.userId, userId))
    .limit(1);
  const row = rows[0];
  if (row && (row.data as WeeklyPlan).weekStart === weekStart) {
    return row.data as WeeklyPlan;
  }
  const plan: WeeklyPlan = {
    id: row?.id ?? crypto.randomUUID(),
    weekStart,
    timezone,
    goals: row ? (row.data as WeeklyPlan).goals : []
  };
  if (row) {
    await db
      .update(schema.weeklyPlans)
      .set({ weekStart, timezone, data: plan, updatedAt: new Date() })
      .where(eq(schema.weeklyPlans.id, row.id));
  } else {
    await db.insert(schema.weeklyPlans).values({
      id: plan.id,
      userId,
      weekStart,
      timezone,
      data: plan
    });
  }
  return plan;
}

async function savePlan(userId: string, plan: WeeklyPlan): Promise<void> {
  if (!db) return;
  await db
    .update(schema.weeklyPlans)
    .set({ data: plan, weekStart: plan.weekStart, timezone: plan.timezone, updatedAt: new Date() })
    .where(eq(schema.weeklyPlans.id, plan.id));
}

async function addGoal(formData: FormData): Promise<void> {
  "use server";
  const session = await auth();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const plan = await loadOrCreatePlan(userId, settings.timezone);
  const goal: WeeklyGoal = {
    id: crypto.randomUUID(),
    title: String(formData.get("title") ?? "").trim() || "Untitled goal",
    targetMinutes: Math.max(15, Number(formData.get("targetMinutes") ?? 60)),
    priority: Math.min(5, Math.max(1, Number(formData.get("priority") ?? 3))),
    energyMode: (String(formData.get("energyMode") ?? "neutral") as EnergyMode),
    ppfHorizon: "unspecified"
  };
  const dow = String(formData.get("dayOfWeek") ?? "");
  if (dow) goal.dayOfWeek = dow as DayOfWeek;
  const wheel = String(formData.get("wheelAreaId") ?? "");
  if (wheel) goal.wheelAreaId = wheel;
  const ppf = String(formData.get("ppfPillar") ?? "");
  if (ppf === "personal" || ppf === "professional" || ppf === "financial") {
    goal.ppfPillar = ppf;
  }
  plan.goals.push(goal);
  await savePlan(userId, plan);
  revalidatePath("/dashboard/goals");
}

async function removeGoal(formData: FormData): Promise<void> {
  "use server";
  const session = await auth();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const plan = await loadOrCreatePlan(userId, settings.timezone);
  const id = String(formData.get("id") ?? "");
  plan.goals = plan.goals.filter((g) => g.id !== id);
  await savePlan(userId, plan);
  revalidatePath("/dashboard/goals");
}

export default async function GoalsPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);
  const plan = await loadOrCreatePlan(userId, settings.timezone);
  const busy = await fetchGoogleBusy(
    userId,
    settings.calendars.sources,
    Date.now(),
    Date.now() + 14 * 24 * 60 * 60 * 1000
  ).catch(() => []);
  const allocation = allocateWeek({ plan, busy, settings });

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">This week</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          Week of <strong>{plan.weekStart}</strong>
        </p>
      </header>

      <section className="card">
        <h2 className="text-sm font-semibold">Add a goal</h2>
        <form action={addGoal} className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">
            Title
            <input name="title" className="field" placeholder="Deep coding" required />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Target minutes
            <input name="targetMinutes" type="number" min={15} step={15} defaultValue={120} className="field" />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Priority (1–5)
            <input name="priority" type="number" min={1} max={5} defaultValue={3} className="field" />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Energy mode
            <select name="energyMode" className="field" defaultValue="neutral">
              <option value="hyperfocus">Hyperfocus (deep)</option>
              <option value="neutral">Neutral</option>
              <option value="hyperaware">Hyperaware (scanning)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Day of week (optional)
            <select name="dayOfWeek" className="field" defaultValue="">
              <option value="">Floating</option>
              <option value="monday">Mon</option>
              <option value="tuesday">Tue</option>
              <option value="wednesday">Wed</option>
              <option value="thursday">Thu</option>
              <option value="friday">Fri</option>
              <option value="saturday">Sat</option>
              <option value="sunday">Sun</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Wheel area (optional)
            <select name="wheelAreaId" className="field" defaultValue="">
              <option value="">—</option>
              {settings.wheel.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            PPF pillar (optional)
            <select name="ppfPillar" className="field" defaultValue="">
              <option value="">—</option>
              <option value="personal">Personal</option>
              <option value="professional">Professional</option>
              <option value="financial">Financial</option>
            </select>
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary w-full">Add goal</button>
          </div>
        </form>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Goals ({plan.goals.length})</h2>
        {plan.goals.length === 0 ? (
          <p className="card text-sm">No goals yet — add one above.</p>
        ) : (
          plan.goals.map((g) => {
            const stats = allocation.metrics.perGoal[g.id];
            return (
              <article key={g.id} className="card flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{g.title}</div>
                  <div className="text-xs text-ink-400">
                    {g.targetMinutes} min · pri {g.priority} · {g.energyMode}
                    {g.dayOfWeek ? ` · ${g.dayOfWeek}` : ""}
                    {g.ppfPillar ? ` · ${g.ppfPillar}` : ""}
                  </div>
                  {stats && (
                    <div className="text-xs text-ink-400">
                      Scheduled: {stats.scheduledMinutes} / {stats.targetMinutes} min
                    </div>
                  )}
                </div>
                <form action={removeGoal}>
                  <input type="hidden" name="id" value={g.id} />
                  <button className="btn-secondary text-xs" type="submit">Remove</button>
                </form>
              </article>
            );
          })
        )}
      </section>

      <section className="card">
        <h2 className="text-sm font-semibold">Week metrics</h2>
        <ul className="mt-2 space-y-1 text-sm">
          <li>
            Available: {allocation.metrics.utilisation.availableMinutes} min · Scheduled:{" "}
            {allocation.metrics.utilisation.scheduledMinutes} min
          </li>
          <li>
            PPF mix · Personal {allocation.metrics.ppfPercent.personal}% / Professional{" "}
            {allocation.metrics.ppfPercent.professional}% / Financial{" "}
            {allocation.metrics.ppfPercent.financial}%
          </li>
          {allocation.metrics.wheelGaps.length > 0 && (
            <li>
              Wheel floors short:{" "}
              {allocation.metrics.wheelGaps
                .map((g) => `${g.areaId} (-${g.shortMinutes}m)`)
                .join(", ")}
            </li>
          )}
          {allocation.metrics.ppfGaps.length > 0 && (
            <li>
              PPF gaps:{" "}
              {allocation.metrics.ppfGaps.map((g) => `${g.pillar} ${g.reason}`).join(", ")}
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
