"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import {
  filterSchedulingGoals,
  type BlockOverride,
  type WeeklyGoal,
  type WeeklyIntent,
  type WeeklyPlan,
  blockOverrideSchema,
  isInvertedTimemapGoal,
  weeklyGoalSchema,
  weeklyIntentSchema,
  weeklyPlanSchema
} from "@calendar-automations/schema";
import { authOrPreview } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { isoCalendarDay, localMidnightMs } from "@/lib/week";
import {
  loadDashboardWeeklyPlan,
  runThisWeekAllocationForPlan
} from "@/lib/perfect-week-this-week-allocation";
import { refreshPlannedSnapshotsForCurrentWeek } from "@/lib/refresh-review-planned-snapshots";
import { runRegenerateForUser } from "@/lib/regenerate-user-snapshot";
import { loadSettings } from "@/lib/settings-store";

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

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
  if (input.specialGoalType === "inverted-timemap") {
    throw new Error("Calendar time-map rows are managed from Calendars, not added here.");
  }
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
  if (isInvertedTimemapGoal(plan.goals[idx]!)) return;
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
  if (isInvertedTimemapGoal(plan.goals[idx]!)) return;
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
  const victim = plan.goals.find((g) => g.id === id);
  if (victim && isInvertedTimemapGoal(victim)) return;
  plan.goals = plan.goals.filter((g) => g.id !== id);
  await savePlan(userId, plan);
  revalidatePlanRoutes();
}

/**
 * Reorder goals by passing the canonical array of ids. Goals whose ids aren't
 * in the array are dropped (useful when reorder fires alongside a delete).
 * Inverted calendar time-map rows are kept at the end and never reordered here.
 */
export async function reorderGoals(orderedIds: readonly string[]): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) throw new Error("unauthorised");
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const plan = await loadOrCreatePlan(userId, settings.timezone);
  const timemapTail = plan.goals.filter((g) => isInvertedTimemapGoal(g));
  const userGoals = plan.goals.filter((g) => !isInvertedTimemapGoal(g));
  const byId = new Map(userGoals.map((g) => [g.id, g] as const));
  const reordered = orderedIds
    .map((id) => byId.get(id))
    .filter((g): g is WeeklyGoal => g !== undefined);
  const seen = new Set(orderedIds);
  const missing = userGoals.filter((g) => !seen.has(g.id));
  plan.goals = [...reordered, ...missing, ...timemapTail];
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
 * Persist a drag override for a sleep, routine, or weekly goal block. Overrides
 * live on the WeeklyPlan rather than UserSettings so a fresh week starts clean.
 *
 * The `key` uniquely identifies the original computed block (`"0".."6"` for
 * sleep nights, `"morning-${i}"` / `"shutdown-${i}"` for routines, planner-built
 * strings for goal slots (`buildGoalDragKey` in the planner package).
 * Setting an override with the same kind + key replaces the previous one.
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

/**
 * Batch upsert goal calendar drag overrides when one visual bar maps to multiple
 * allocator slices (merged adjacent blocks). Single save + revalidation.
 */
export async function setGoalBlockOverridesBatch(
  updates: Array<Omit<BlockOverride, "setAt">>
): Promise<void> {
  if (updates.length === 0) return;
  const session = await authOrPreview();
  if (!session?.user?.id) throw new Error("unauthorised");
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const plan = await loadOrCreatePlan(userId, settings.timezone);
  const setAt = Date.now();
  let next = [...plan.overrides];
  for (const u of updates) {
    const parsed = blockOverrideSchema.parse({ ...u, setAt });
    next = next.filter((o) => !(o.kind === parsed.kind && o.key === parsed.key));
    next.push(parsed);
  }
  plan.overrides = next;
  await savePlan(userId, plan);
  revalidatePlanRoutes();
}

/** Remove all goal drag overrides matching `keys` in one write (merged-bar reset). */
export async function clearGoalDragOverrides(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const session = await authOrPreview();
  if (!session?.user?.id) throw new Error("unauthorised");
  const userId = session.user.id;
  const settings = await loadSettings(userId);
  const plan = await loadOrCreatePlan(userId, settings.timezone);
  const keySet = new Set(keys);
  const before = plan.overrides.length;
  plan.overrides = plan.overrides.filter((o) => !(o.kind === "goal" && keySet.has(o.key)));
  if (plan.overrides.length === before) return;
  await savePlan(userId, plan);
  revalidatePlanRoutes();
}

function isActualGoalOverride(o: BlockOverride): boolean {
  return o.kind === "goal" && o.source === "actual";
}

/**
 * Maps day-sheet goal log slots to planner goal drag overrides (`source:
 * "actual"`). Pairs each slot to the baseline allocator block with the
 * greatest time overlap on that day (each `dragKey` at most once). Falls back
 * to `plannedBlocksSnapshot` overlap when needed. Manual drag overrides are
 * preserved. Triggers snapshot regeneration so iCal stays in sync.
 */
export async function syncActualGoalOverridesFromDayLogs(): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id) return;
  const userId = session.user.id;
  if (!db) return;

  try {
    const settings = await loadSettings(userId);
    const tz = settings.timezone;
    const planFull = await loadDashboardWeeklyPlan(userId, tz);

    const planBaseline: WeeklyPlan = {
      ...planFull,
      overrides: planFull.overrides.filter((o) => !isActualGoalOverride(o))
    };

    const run = await runThisWeekAllocationForPlan(userId, planBaseline, settings);
    if (!run) return;

    const { allocation, weekDates, reviewsByDate } = run;
    const schedulingIds = new Set(filterSchedulingGoals(planFull.goals).map((g) => g.id));

    const paired: BlockOverride[] = [];
    const setAt = Date.now();

    for (const date of weekDates) {
      const review = reviewsByDate.get(date);
      if (!review) continue;

      const slots = review.slots.filter(
        (s) => s.category === "goal" && s.goalId && schedulingIds.has(s.goalId)
      );
      if (slots.length === 0) continue;

      const byGoal = new Map<string, typeof slots>();
      for (const s of slots) {
        const gid = s.goalId!;
        const list = byGoal.get(gid);
        if (list) list.push(s);
        else byGoal.set(gid, [s]);
      }

      for (const [goalId, slotList] of byGoal) {
        slotList.sort((a, b) => a.startMinute - b.startMinute);
        const blocksForDay = allocation.blocks
          .filter(
            (b) =>
              b.goalId === goalId &&
              !b.segment &&
              Boolean(b.dragKey) &&
              isoCalendarDay(b.startMs, tz) === date
          )
          .sort((a, b) => a.startMs - b.startMs);

        const usedDragKeys = new Set<string>();
        const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
        const dayStartMs = localMidnightMs(y, mo, d, tz);

        for (const slot of slotList) {
          const slotStart = dayStartMs + slot.startMinute * 60 * 1000;
          const slotEnd = dayStartMs + slot.endMinute * 60 * 1000;

          let bestBlock: (typeof blocksForDay)[number] | undefined;
          let bestOv = 0;
          for (const b of blocksForDay) {
            if (!b.dragKey || usedDragKeys.has(b.dragKey)) continue;
            const ov = overlapMs(slotStart, slotEnd, b.startMs, b.endMs);
            if (ov > bestOv) {
              bestOv = ov;
              bestBlock = b;
            }
          }

          let dragKey: string | undefined = bestBlock?.dragKey;
          if (!dragKey || bestOv <= 0) {
            const snaps =
              review.plannedBlocksSnapshot?.filter(
                (p) =>
                  p.goalId === goalId &&
                  isoCalendarDay(p.startMs, tz) === date &&
                  overlapMs(slotStart, slotEnd, p.startMs, p.endMs) > 0
              ) ?? [];
            snaps.sort(
              (p, q) =>
                overlapMs(slotStart, slotEnd, q.startMs, q.endMs) -
                overlapMs(slotStart, slotEnd, p.startMs, p.endMs)
            );
            const bestSnap = snaps[0];
            if (bestSnap) {
              let bestOv2 = -1;
              let bestB2: (typeof allocation.blocks)[number] | undefined;
              for (const b of allocation.blocks) {
                if (
                  b.goalId !== goalId ||
                  b.segment ||
                  !b.dragKey ||
                  usedDragKeys.has(b.dragKey) ||
                  isoCalendarDay(b.startMs, tz) !== date
                ) {
                  continue;
                }
                const ov = overlapMs(bestSnap.startMs, bestSnap.endMs, b.startMs, b.endMs);
                if (ov > bestOv2) {
                  bestOv2 = ov;
                  bestB2 = b;
                }
              }
              if (bestB2?.dragKey) dragKey = bestB2.dragKey;
            }
          }

          if (!dragKey) {
            console.warn("syncActualGoalOverridesFromDayLogs: unpaired goal slot", {
              date,
              goalId,
              slot
            });
            continue;
          }
          usedDragKeys.add(dragKey);
          paired.push(
            blockOverrideSchema.parse({
              kind: "goal",
              key: dragKey,
              startMs: slotStart,
              endMs: slotEnd,
              source: "actual",
              setAt
            })
          );
        }
      }
    }

    const preserved = planFull.overrides.filter((o) => !isActualGoalOverride(o));
    const pairedKeys = new Set(paired.map((p) => p.key));
    const preservedNoPinCollision = preserved.filter(
      (o) => !(o.kind === "goal" && pairedKeys.has(o.key))
    );
    planFull.overrides = [...preservedNoPinCollision, ...paired];
    weeklyPlanSchema.parse(planFull);
    await savePlan(userId, planFull);
    await refreshPlannedSnapshotsForCurrentWeek(userId, planFull, settings);
    revalidatePlanRoutes();
    revalidatePath("/dashboard/review");
    revalidatePath("/dashboard/week-review");
    await runRegenerateForUser(userId);
  } catch (err) {
    console.warn("syncActualGoalOverridesFromDayLogs failed", err);
  }
}
