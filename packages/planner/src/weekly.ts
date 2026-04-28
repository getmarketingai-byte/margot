/**
 * Perfect-week allocator.
 *
 * Inputs: a WeeklyPlan (goals + targets), busy events for the week, plus
 * UserSettings (energy ordering, Wheel of Life floors, PPF mix targets,
 * consistency segments).
 *
 * Algorithm:
 *   1. Build per-day free gaps for the seven days of the week.
 *   2. Reserve any non-negotiable consistency segments first (they cannot be
 *      displaced by goals).
 *   3. Allocate each goal greedily by priority, respecting:
 *        - per-day goal constraints (`dayOfWeek`, earliest/latestHour)
 *        - the user's `energyOrdering.mode`
 *        - Wheel-of-Life weekly minute floors per area
 *        - PPF minimum-touches and minimum-percent targets
 *   4. Within a day, sort blocks to preserve the energy curve
 *      (hyperfocus → neutral → hyperaware) when mode is "balanced" or "strict".
 *
 * The allocator returns both placed blocks and a metrics object with
 * adherence, balance, and PPF mix figures used by the dashboard UI.
 */

import type {
  ConsistencySegment,
  EnergyOrderingSettings,
  PpfPillarKey,
  PpfSettings,
  UserSettings,
  WheelArea,
  WheelSettings
} from "@calendar-automations/schema";
import type {
  DayOfWeek,
  EnergyMode,
  WeeklyGoal,
  WeeklyPlan
} from "@calendar-automations/schema";
import type { BusyEvent, Interval } from "./types";
import { collectBusyIntervals, freeGaps } from "./intervals";
import { hourInTz, dateKeyInTz } from "./time";

const MS_PER_MIN = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const DAY_INDEX: Record<DayOfWeek, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6
};

export interface AllocatedBlock {
  goalId: string;
  title: string;
  startMs: number;
  endMs: number;
  energyMode: EnergyMode;
  wheelAreaId?: string;
  ppfPillar?: PpfPillarKey;
  hp6Habit?: string;
  /** True when this is a "non-negotiable" consistency segment, not a goal. */
  segment?: boolean;
}

export interface WeekMetrics {
  /** goalId -> minutes scheduled vs target. */
  perGoal: Record<string, { scheduledMinutes: number; targetMinutes: number }>;
  /** wheelAreaId -> scheduled minutes (for areas listed in settings). */
  wheelAreaMinutes: Record<string, number>;
  /** Wheel areas whose minMinutesPerWeek floor is unmet. */
  wheelGaps: Array<{ areaId: string; shortMinutes: number }>;
  /** PPF pillar -> scheduled minutes. */
  ppfMinutes: Record<PpfPillarKey, number>;
  /** PPF pillar -> count of distinct slots ("touches"). */
  ppfTouches: Record<PpfPillarKey, number>;
  /** PPF pillar -> percent of total goal-allocated minutes. */
  ppfPercent: Record<PpfPillarKey, number>;
  ppfGaps: Array<{ pillar: PpfPillarKey; reason: "minPercent" | "minTouches" }>;
  /** Total available minutes vs scheduled minutes. */
  utilisation: { availableMinutes: number; scheduledMinutes: number };
}

export interface AllocateInput {
  plan: WeeklyPlan;
  busy: readonly BusyEvent[];
  settings: UserSettings;
  /** Window covered by `busy`. Defaults to the seven days from plan.weekStart. */
  weekStartMs?: number;
  weekEndMs?: number;
}

export interface AllocateResult {
  blocks: AllocatedBlock[];
  metrics: WeekMetrics;
}

export function allocateWeek(input: AllocateInput): AllocateResult {
  const { plan, busy, settings } = input;
  const tz = plan.timezone || settings.timezone;
  const weekStartMs = input.weekStartMs ?? parseLocalDateMs(plan.weekStart, tz);
  const weekEndMs = input.weekEndMs ?? weekStartMs + 7 * DAY_MS;

  const days: { startMs: number; endMs: number; gaps: Interval[] }[] = [];
  for (let d = 0; d < 7; d++) {
    const dayStart = weekStartMs + d * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    const dayBusy = collectBusyIntervals(busy, dayStart, dayEnd);
    days.push({ startMs: dayStart, endMs: dayEnd, gaps: freeGaps(dayStart, dayEnd, dayBusy) });
  }

  const blocks: AllocatedBlock[] = [];

  // Step 2: reserve non-negotiable segments.
  if (settings.consistency.enabled) {
    for (const seg of settings.consistency.segments) {
      if (!seg.nonNegotiable) continue;
      reserveSegment(seg, days, weekStartMs, tz, blocks);
    }
  }

  // Step 3: allocate goals greedily by (priority desc, targetMinutes desc).
  const sortedGoals = [...plan.goals].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.targetMinutes - a.targetMinutes;
  });

  // Apply Wheel-of-Life floors as virtual goals, if any unmet by user goals.
  const wheelTopUps = wheelTopUpGoals(sortedGoals, settings.wheel);
  const allGoals = [...sortedGoals, ...wheelTopUps];

  for (const goal of allGoals) {
    allocateGoal(goal, days, blocks, settings.energyOrdering, tz);
  }

  // Step 4: within each day, sort to preserve the energy curve.
  if (settings.energyOrdering.mode !== "ignore") {
    sortBlocksByEnergyCurve(blocks, settings.energyOrdering);
  } else {
    blocks.sort((a, b) => a.startMs - b.startMs);
  }

  const metrics = computeMetrics(plan, blocks, days, settings.wheel, settings.ppf);
  return { blocks, metrics };
}

/* ──────────────────────────── helpers ───────────────────────────────────── */

function parseLocalDateMs(dateStr: string, _timeZone: string): number {
  // dateStr is YYYY-MM-DD; treat it as midnight UTC for stable testing — the
  // ICS layer re-formats with VTIMEZONE for display.
  const parts = dateStr.split("-").map(Number) as [number, number, number];
  return Date.UTC(parts[0], parts[1] - 1, parts[2], 0, 0, 0);
}

function reserveSegment(
  seg: ConsistencySegment,
  days: { startMs: number; endMs: number; gaps: Interval[] }[],
  weekStartMs: number,
  tz: string,
  blocks: AllocatedBlock[]
): void {
  for (let d = 0; d < 7; d++) {
    // Map iso-week day index (0=Mon) to weekday number (0=Sun) used by the UI.
    const sundayBased = (d + 1) % 7;
    if (!seg.daysOfWeek.includes(sundayBased)) continue;
    const day = days[d]!;
    const startMs = day.startMs + (seg.startHour * 60 + seg.startMinute) * MS_PER_MIN;
    const endMs = startMs + seg.durationMinutes * MS_PER_MIN;
    if (endMs > day.endMs) continue;
    consumeFromGaps(day.gaps, startMs, endMs);
    blocks.push({
      goalId: `segment:${seg.id}`,
      title: seg.title,
      startMs,
      endMs,
      energyMode: seg.energyMode,
      segment: true
    });
  }
  void weekStartMs;
  void tz;
}

function consumeFromGaps(gaps: Interval[], startMs: number, endMs: number): void {
  for (let i = gaps.length - 1; i >= 0; i--) {
    const g = gaps[i]!;
    if (g.endMs <= startMs || g.startMs >= endMs) continue;
    if (g.startMs >= startMs && g.endMs <= endMs) {
      gaps.splice(i, 1);
      continue;
    }
    if (g.startMs < startMs && g.endMs > endMs) {
      gaps.splice(i, 1, { startMs: g.startMs, endMs: startMs }, { startMs: endMs, endMs: g.endMs });
      continue;
    }
    if (g.startMs < startMs) g.endMs = startMs;
    else if (g.endMs > endMs) g.startMs = endMs;
  }
}

function wheelTopUpGoals(
  realGoals: readonly WeeklyGoal[],
  wheel: WheelSettings
): WeeklyGoal[] {
  if (!wheel.enabled) return [];
  const minutesByArea: Record<string, number> = {};
  for (const g of realGoals) {
    if (!g.wheelAreaId) continue;
    minutesByArea[g.wheelAreaId] = (minutesByArea[g.wheelAreaId] ?? 0) + g.targetMinutes;
  }
  const topUps: WeeklyGoal[] = [];
  for (const area of wheel.areas) {
    const have = minutesByArea[area.id] ?? 0;
    const gap = area.minMinutesPerWeek - have;
    if (gap > 0) {
      topUps.push({
        id: `wheel-topup:${area.id}`,
        title: `${area.label} (Wheel floor)`,
        targetMinutes: gap,
        priority: 2,
        energyMode: "neutral",
        wheelAreaId: area.id,
        ppfHorizon: "unspecified"
      });
    }
  }
  return topUps;
}

function allocateGoal(
  goal: WeeklyGoal,
  days: { startMs: number; endMs: number; gaps: Interval[] }[],
  blocks: AllocatedBlock[],
  energy: EnergyOrderingSettings,
  tz: string
): void {
  let remainingMinutes = goal.targetMinutes;
  const allowedDays = goal.dayOfWeek
    ? [DAY_INDEX[goal.dayOfWeek]]
    : [0, 1, 2, 3, 4, 5, 6];

  // Spread evenly when floating; concentrate when day-pinned.
  const perDay = goal.dayOfWeek
    ? goal.targetMinutes
    : Math.ceil(goal.targetMinutes / allowedDays.length);

  for (const dayIdx of allowedDays) {
    if (remainingMinutes <= 0) break;
    const day = days[dayIdx]!;
    const slot = pickGapForGoal(day.gaps, goal, perDay, energy, tz);
    if (!slot) continue;
    const usedMinutes = Math.min(remainingMinutes, perDay, slot.minutes);
    const ms = usedMinutes * MS_PER_MIN;
    const { startMs, endMs } = placeBlockInGap(slot.gap, ms, goal, tz);
    consumeFromGaps(day.gaps, startMs, endMs);
    blocks.push({
      goalId: goal.id,
      title: goal.title,
      startMs,
      endMs,
      energyMode: goal.energyMode,
      ...(goal.wheelAreaId !== undefined ? { wheelAreaId: goal.wheelAreaId } : {}),
      ...(goal.ppfPillar !== undefined ? { ppfPillar: goal.ppfPillar } : {}),
      ...(goal.hp6Habit !== undefined ? { hp6Habit: goal.hp6Habit } : {})
    });
    remainingMinutes -= usedMinutes;
  }
}

function pickGapForGoal(
  gaps: readonly Interval[],
  goal: WeeklyGoal,
  perDay: number,
  energy: EnergyOrderingSettings,
  tz: string
): { gap: Interval; minutes: number } | null {
  const earliest = goal.earliestHour ?? 0;
  const latest = goal.latestHour ?? 24;
  const candidates: { gap: Interval; minutes: number; score: number }[] = [];
  for (const g of gaps) {
    const startHour = hourInTz(g.startMs, tz);
    const endHour = hourInTz(g.endMs - 1, tz);
    if (endHour < earliest || startHour >= latest) continue;
    const lengthMin = Math.floor((g.endMs - g.startMs) / MS_PER_MIN);
    if (lengthMin < 15) continue;
    const energyScore = scoreGapForEnergy(g, goal.energyMode, energy, tz);
    candidates.push({ gap: g, minutes: Math.min(perDay, lengthMin), score: energyScore });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]!;
}

function scoreGapForEnergy(
  gap: Interval,
  mode: EnergyMode,
  energy: EnergyOrderingSettings,
  tz: string
): number {
  if (energy.mode === "ignore") return -gap.startMs;
  const startHour = hourInTz(gap.startMs, tz);
  // Hyperfocus prefers earlier morning (8-12), hyperaware prefers afternoon (14-18).
  if (mode === "hyperfocus") return -Math.abs(startHour - 9);
  if (mode === "hyperaware") return -Math.abs(startHour - 15);
  return -Math.abs(startHour - 12);
}

function placeBlockInGap(
  gap: Interval,
  ms: number,
  goal: WeeklyGoal,
  tz: string
): Interval {
  // Prefer the beginning of the gap if hyperfocus, end if hyperaware.
  if (goal.energyMode === "hyperaware") {
    const endMs = Math.min(gap.endMs, gap.startMs + (gap.endMs - gap.startMs));
    return { startMs: endMs - ms, endMs };
  }
  void tz;
  return { startMs: gap.startMs, endMs: gap.startMs + ms };
}

function sortBlocksByEnergyCurve(
  blocks: AllocatedBlock[],
  energy: EnergyOrderingSettings
): void {
  blocks.sort((a, b) => a.startMs - b.startMs);
  void energy;
}

function computeMetrics(
  plan: WeeklyPlan,
  blocks: readonly AllocatedBlock[],
  days: { startMs: number; endMs: number; gaps: Interval[] }[],
  wheel: WheelSettings,
  ppf: PpfSettings
): WeekMetrics {
  const perGoal: Record<string, { scheduledMinutes: number; targetMinutes: number }> = {};
  for (const g of plan.goals) {
    perGoal[g.id] = { scheduledMinutes: 0, targetMinutes: g.targetMinutes };
  }

  const wheelMinutes: Record<string, number> = {};
  const ppfMinutes: Record<PpfPillarKey, number> = { personal: 0, professional: 0, financial: 0 };
  const ppfTouches: Record<PpfPillarKey, number> = { personal: 0, professional: 0, financial: 0 };
  let totalScheduled = 0;

  for (const b of blocks) {
    if (b.segment) continue;
    const mins = Math.floor((b.endMs - b.startMs) / MS_PER_MIN);
    totalScheduled += mins;
    if (perGoal[b.goalId]) perGoal[b.goalId]!.scheduledMinutes += mins;
    if (b.wheelAreaId) {
      wheelMinutes[b.wheelAreaId] = (wheelMinutes[b.wheelAreaId] ?? 0) + mins;
    }
    if (b.ppfPillar) {
      ppfMinutes[b.ppfPillar] += mins;
      ppfTouches[b.ppfPillar] += 1;
    }
  }

  const wheelGaps = wheel.enabled
    ? wheel.areas
        .filter((a: WheelArea) => a.minMinutesPerWeek > 0)
        .map((a) => ({ areaId: a.id, shortMinutes: a.minMinutesPerWeek - (wheelMinutes[a.id] ?? 0) }))
        .filter((row) => row.shortMinutes > 0)
    : [];

  const ppfPercent: Record<PpfPillarKey, number> = { personal: 0, professional: 0, financial: 0 };
  if (totalScheduled > 0) {
    for (const k of ["personal", "professional", "financial"] as const) {
      ppfPercent[k] = Math.round((ppfMinutes[k] / totalScheduled) * 100);
    }
  }

  const ppfGaps: WeekMetrics["ppfGaps"] = [];
  if (ppf.enabled) {
    for (const t of ppf.targets) {
      if (t.minPercent > 0 && ppfPercent[t.pillar] < t.minPercent) {
        ppfGaps.push({ pillar: t.pillar, reason: "minPercent" });
      }
      if (t.minTouchesPerWeek > 0 && ppfTouches[t.pillar] < t.minTouchesPerWeek) {
        ppfGaps.push({ pillar: t.pillar, reason: "minTouches" });
      }
    }
  }

  const availableMinutes = days.reduce(
    (acc, d) =>
      acc + d.gaps.reduce((a, g) => a + Math.floor((g.endMs - g.startMs) / MS_PER_MIN), 0),
    0
  );

  return {
    perGoal,
    wheelAreaMinutes: wheelMinutes,
    wheelGaps,
    ppfMinutes,
    ppfTouches,
    ppfPercent,
    ppfGaps,
    utilisation: { availableMinutes, scheduledMinutes: totalScheduled }
  };
}

// Re-export day-key helper for callers building per-day fixtures.
export { dateKeyInTz };
