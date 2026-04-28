/**
 * Energy planning page (the "second page" of the dashboard).
 *
 * This is a manual classification surface: the user drags/selects each goal
 * into an energy polarity (energises / neutral / drains) and tags the
 * Bustamante hyper-mode plus a four-layer work category. Updates flow through
 * the same server actions as the Perfect Week page so the goal store stays
 * single-source-of-truth.
 *
 * Phase 2 introduces a scheduling-suggestion layer that consumes these tags;
 * this page is the input for that layer.
 */

import { eq } from "drizzle-orm";
import { type WeeklyPlan } from "@calendar-automations/schema";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { loadSettings } from "@/lib/settings-store";
import { localMondayIso } from "@/lib/week";
import { EnergyBoardClient } from "./energy-board-client";

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

export default async function EnergyPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const settings = await loadSettings(userId);
  const plan = await loadPlan(userId, settings.timezone);
  const wheelAreas = settings.wheel.areas.map((a) => ({ id: a.id, label: a.label }));

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">Energy planning</h1>
        <p className="text-sm text-ink-600 dark:text-ink-200">
          Classify each goal so the planner can batch energising vs draining work and
          honour your hyper-focus / hyper-awareness rhythm.
        </p>
      </header>

      <EnergyBoardClient initialGoals={plan.goals} wheelAreas={wheelAreas} />
    </div>
  );
}
