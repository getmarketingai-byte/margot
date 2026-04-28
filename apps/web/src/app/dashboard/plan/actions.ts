"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import {
  type BlockOverride,
  type WeeklyGoal,
  type WeeklyIntent,
  type WeeklyPlan,
  blockOverrideSchema,
  weeklyGoalSchema,
  weeklyIntentSchema,
  weeklyPlanSchema
} from "@calendar-automations/schema";
import { authOrPreview } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { loadSettings } from "@/lib/settings-store";

/**
 * Routes that read either the goal list or the weekly intent need to be
 * invalidated whenever those slices change. Centralising the list keeps the
 * planning hub and Perfect Week page in sync after an edit.
 */
function revalidatePlanRoutes(): void {
  revalidatePath("/dashboard/plan");
  revalidatePath("/dashboard/energy");
  revalidatePath("/dashboard");
}

/**
 * The Perfect Week page treats the user's `weekly_plan` row as a singleton:
 * the goals list is the *recurring blueprint*, not a per-week snapshot. We
 * keep `weekStart` updated to "this Monday" so the allocator and feeds
 * continue to anchor against the current week.
 */

function thisMondayIso(): string {
  const now = new Date();
  const dow = (now.getUTCDay() + 6) % 7;
  const mon = new Date(now.getTime() - dow * 24 * 60 * 60 * 1000);
  return mon.toISOString().slice(0, 10);
}

async function loadOrCreatePlan(userId: string, timezone: string): Promise<WeeklyPlan> {
  const weekStart = thisMondayIso();
  if (!db) {
    return {
      id: "dev",
      weekStart,
      timezone,
      goals: [],
      overrides: [],
      weeklyIntent: weeklyIntentSchema.parse({})
    };
  }
  const rows = await db
    .select()
    .from(schema.weeklyPlans)
    .where(eq(schema.weeklyPlans.userId, userId))
    .limit(1);
  const row = rows[0];
  const stored = row ? (row.data as Partial<WeeklyPlan>) : null;
  const baseGoals = stored?.goals ?? [];
  const baseOverrides = stored?.overrides ?? [];
  const baseIntent = weeklyIntentSchema.parse(stored?.weeklyIntent ?? {});
  const plan: WeeklyPlan = {
    id: row?.id ?? crypto.randomUUID(),
    weekStart,
    timezone,
    goals: baseGoals,
    overrides: baseOverrides,
    weeklyIntent: baseIntent
  };
  if (row && (row.data as WeeklyPlan).weekStart !== weekStart) {
    await db
      .update(schema.weeklyPlans)
      .set({ weekStart, timezone, data: plan, updatedAt: new Date() })
      .where(eq(schema.weeklyPlans.id, row.id));
  } else if (!row) {
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
  void userId;
  if (!db) return;
  await db
    .update(schema.weeklyPlans)
    .set({ data: plan, weekStart: plan.weekStart, timezone: plan.timezone, updatedAt: new Date() })
    .where(eq(schema.weeklyPlans.id, plan.id));
}

/**
 * Add a new goal. The client passes the full goal shape (without id) so the
 * server doesn't need to mirror every chip field in formdata. This keeps the
 * action signature stable as we add new optional fields to `WeeklyGoal`.
 */
export async function addGoal(input: Omit<WeeklyGoal, "id">): Promise<{ id: string }> {
  const session = await authOrPreview();
  if (!session?.user?.id) throw new Error("unauthorised");
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const plan = await loadOrCreatePlan(userId, settings.timezone);
  const id = crypto.randomUUID();
  const parsed = weeklyGoalSchema.parse({ ...input, id });
  plan.goals.push(parsed);
  await savePlan(userId, plan);
  revalidatePlanRoutes();
  return { id };
}

/**
 * Replace a single goal by id with a new partial shape. Anything the caller
 * omits is treated as "clear that field" — chip removal is just an update.
 */
export async function updateGoal(id: string, input: Omit<WeeklyGoal, "id">): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) throw new Error("unauthorised");
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const plan = await loadOrCreatePlan(userId, settings.timezone);
  const idx = plan.goals.findIndex((g) => g.id === id);
  if (idx < 0) return;
  plan.goals[idx] = weeklyGoalSchema.parse({ ...input, id });
  await savePlan(userId, plan);
  revalidatePlanRoutes();
}

/**
 * Patch a single field on a goal without re-sending the rest of the shape.
 * Used by the planning hub kanban boards: dropping a card on a column should
 * write one canonical field at a time. Only fields the caller passes in are
 * changed; everything else round-trips through the schema unchanged.
 */
export async function patchGoal(
  id: string,
  patch: Partial<Omit<WeeklyGoal, "id">>
): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) throw new Error("unauthorised");
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const plan = await loadOrCreatePlan(userId, settings.timezone);
  const idx = plan.goals.findIndex((g) => g.id === id);
  if (idx < 0) return;
  const merged = { ...plan.goals[idx]!, ...patch, id };
  plan.goals[idx] = weeklyGoalSchema.parse(merged);
  await savePlan(userId, plan);
  revalidatePlanRoutes();
}

export async function removeGoal(id: string): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) throw new Error("unauthorised");
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const plan = await loadOrCreatePlan(userId, settings.timezone);
  plan.goals = plan.goals.filter((g) => g.id !== id);
  await savePlan(userId, plan);
  revalidatePlanRoutes();
}

/**
 * Reorder goals by passing the canonical array of ids. Goals whose ids aren't
 * in the array are dropped (useful when reorder fires alongside a delete).
 */
export async function reorderGoals(orderedIds: readonly string[]): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) throw new Error("unauthorised");
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const plan = await loadOrCreatePlan(userId, settings.timezone);
  const byId = new Map(plan.goals.map((g) => [g.id, g] as const));
  plan.goals = orderedIds
    .map((id) => byId.get(id))
    .filter((g): g is WeeklyGoal => g !== undefined);
  weeklyPlanSchema.parse(plan);
  await savePlan(userId, plan);
  revalidatePlanRoutes();
}

/**
 * Persist the Burchard-style weekly intention prompts. The whole intent
 * shape is replaced atomically to keep the UI's state simple; passing a
 * partial object (`{ mainOutcomes: "..." }`) is supported via the schema's
 * optional fields.
 */
export async function updateWeeklyIntent(input: WeeklyIntent): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) throw new Error("unauthorised");
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const plan = await loadOrCreatePlan(userId, settings.timezone);
  plan.weeklyIntent = weeklyIntentSchema.parse(input);
  await savePlan(userId, plan);
  revalidatePlanRoutes();
}

/**
 * Persist a drag override for a sleep or routine block. Overrides live on
 * the WeeklyPlan rather than UserSettings so a fresh week starts clean.
 *
 * The `key` uniquely identifies the original computed block (`"0".."6"` for
 * sleep nights, `"morning-${i}"` / `"shutdown-${i}"` for routines). Setting
 * an override with the same key replaces the previous one.
 */
export async function setBlockOverride(
  override: Omit<BlockOverride, "setAt">
): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) throw new Error("unauthorised");
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const plan = await loadOrCreatePlan(userId, settings.timezone);

  const parsed = blockOverrideSchema.parse({ ...override, setAt: Date.now() });
  // Drag overrides supersede any prior override on the same key. A `kind`
  // mismatch on the same key is treated as a fresh override (the new kind
  // wins) — this should only happen if the schema changes.
  const filtered = plan.overrides.filter(
    (o) => !(o.kind === parsed.kind && o.key === parsed.key)
  );
  plan.overrides = [...filtered, parsed];
  await savePlan(userId, plan);
  revalidatePlanRoutes();
}

/** Remove an override by `kind` + `key`. No-op if no matching override exists. */
export async function clearBlockOverride(
  kind: BlockOverride["kind"],
  key: string
): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) throw new Error("unauthorised");
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const plan = await loadOrCreatePlan(userId, settings.timezone);
  const before = plan.overrides.length;
  plan.overrides = plan.overrides.filter((o) => !(o.kind === kind && o.key === key));
  if (plan.overrides.length === before) return;
  await savePlan(userId, plan);
  revalidatePlanRoutes();
}
