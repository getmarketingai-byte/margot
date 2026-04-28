"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import {
  type WeeklyGoal,
  type WeeklyPlan,
  weeklyGoalSchema,
  weeklyPlanSchema
} from "@calendar-automations/schema";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { loadSettings } from "@/lib/settings-store";

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
    return { id: "dev", weekStart, timezone, goals: [] };
  }
  const rows = await db
    .select()
    .from(schema.weeklyPlans)
    .where(eq(schema.weeklyPlans.userId, userId))
    .limit(1);
  const row = rows[0];
  const baseGoals = row ? (row.data as WeeklyPlan).goals : [];
  const plan: WeeklyPlan = {
    id: row?.id ?? crypto.randomUUID(),
    weekStart,
    timezone,
    goals: baseGoals
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
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorised");
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const plan = await loadOrCreatePlan(userId, settings.timezone);
  const id = crypto.randomUUID();
  const parsed = weeklyGoalSchema.parse({ ...input, id });
  plan.goals.push(parsed);
  await savePlan(userId, plan);
  revalidatePath("/dashboard/plan");
  revalidatePath("/dashboard");
  return { id };
}

/**
 * Replace a single goal by id with a new partial shape. Anything the caller
 * omits is treated as "clear that field" — chip removal is just an update.
 */
export async function updateGoal(id: string, input: Omit<WeeklyGoal, "id">): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorised");
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const plan = await loadOrCreatePlan(userId, settings.timezone);
  const idx = plan.goals.findIndex((g) => g.id === id);
  if (idx < 0) return;
  plan.goals[idx] = weeklyGoalSchema.parse({ ...input, id });
  await savePlan(userId, plan);
  revalidatePath("/dashboard/plan");
  revalidatePath("/dashboard");
}

export async function removeGoal(id: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorised");
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const plan = await loadOrCreatePlan(userId, settings.timezone);
  plan.goals = plan.goals.filter((g) => g.id !== id);
  await savePlan(userId, plan);
  revalidatePath("/dashboard/plan");
  revalidatePath("/dashboard");
}

/**
 * Reorder goals by passing the canonical array of ids. Goals whose ids aren't
 * in the array are dropped (useful when reorder fires alongside a delete).
 */
export async function reorderGoals(orderedIds: readonly string[]): Promise<void> {
  const session = await auth();
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
  revalidatePath("/dashboard/plan");
  revalidatePath("/dashboard");
}
