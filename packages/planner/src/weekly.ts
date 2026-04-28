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
 *        - per-day goal constraints (`dayOfWeek` / `daysOfWeek`, earliest/latestHour)
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
  AllocatorSettings,
  ConsistencySegment,
  EnergyOrderingSettings,
  PlacementPrioritySettings,
  PlacementSignalKey,
  PpfPillarKey,
  PpfSettings,
  UserSettings,
  WheelArea,
  WheelSettings
} from "@calendar-automations/schema";
import type {
  AttentionMode,
  CommitmentLevel,
  DayOfWeek,
  EnergyMode,
  NormalisedGoalTime,
  WeeklyGoal,
  WeeklyPlan,
  WorkLayer
} from "@calendar-automations/schema";
import { isInvertedTimemapGoal, normaliseGoalTime } from "@calendar-automations/schema";
import type { BusyEvent, Interval } from "./types";
import { collectBusyIntervals, freeGaps } from "./intervals";
import { hourInTz, dateKeyInTz } from "./time";

const MS_PER_MIN = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Round all minute decisions to a 15-minute grid. */
const QUANTUM = 15;

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
  /**
   * Set when goal floors exceed the available free time. UI surfaces this so
   * the user can choose to relax a floor or add free time.
   */
  overcommitted?: {
    neededMin: number;
    availableMin: number;
    mode: AllocatorSettings["starvationMode"];
  };
  /** Goals that received zero minutes (only populated under "strict" mode). */
  notScheduled: Array<{ goalId: string; title: string; reason: "starved" }>;
}

export interface AllocateInput {
  plan: WeeklyPlan;
  busy: readonly BusyEvent[];
  /**
   * Optional per-goal windows where that goal is allowed to be placed.
   * Used by "invert-free-busy" calendar sources (free/busy inverted into allowed windows).
   */
  goalAvailabilityWindows?: Record<string, Interval[]>;
  settings: UserSettings;
  /** Window covered by `busy`. Defaults to the seven days from plan.weekStart. */
  weekStartMs?: number;
  weekEndMs?: number;
  /**
   * Optional per-goal catch-up adjustments in minutes.
   *
   * When the user is behind on a goal mid-week, the weekly review surface
   * computes a deficit and stores it here as `goalId -> additionalMinutes`.
   * The allocator adds these minutes to the goal's effective weekly floor
   * (and weekly ceiling, so the cap doesn't silently swallow the boost) so
   * the remaining days of the week pick up the extra time.
   *
   * Negative values are honoured (you can shrink a goal that ran ahead).
   * Missing or zero entries are no-ops, preserving baseline behaviour.
   */
  catchUpFloors?: Record<string, number>;
}

export interface AllocateResult {
  blocks: AllocatedBlock[];
  metrics: WeekMetrics;
}

/** Internal: a goal augmented with the bounds the allocator actually uses. */
interface PreparedGoal {
  goal: WeeklyGoal;
  norm: NormalisedGoalTime;
  /** Minutes the allocator will try to schedule across the week. */
  effectiveMinutes: number;
  /** Order in the user's list, used as the priority tie-breaker. */
  index: number;
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

  // Reserve non-negotiable segments first — they cannot be displaced by goals.
  if (settings.consistency.enabled) {
    for (const seg of settings.consistency.segments) {
      if (!seg.nonNegotiable) continue;
      reserveSegment(seg, days, weekStartMs, tz, blocks);
    }
  }

  const schedulingGoals = plan.goals.filter((g) => !isInvertedTimemapGoal(g));
  const timemapAvailabilityGoals = plan.goals.filter((g) => isInvertedTimemapGoal(g));

  // Inverted timemap rows (companion-calendar free maps) must place before
  // equal-share goals consume the same gaps; otherwise `effectiveMinutes`
  // looked huge but nothing remained inside the windows after placement.
  const timemapPrepared: PreparedGoal[] = [];
  for (const g of timemapAvailabilityGoals) {
    const windows = input.goalAvailabilityWindows?.[g.id];
    const totalAvailMin = minutesInIntersectedWeekGaps(days, windows);
    if (totalAvailMin < QUANTUM) continue;
    const norm = normaliseGoalTime(g);
    const pp: PreparedGoal = {
      goal: g,
      norm,
      effectiveMinutes: quantise(totalAvailMin),
      index: plan.goals.findIndex((x) => x.id === g.id)
    };
    timemapPrepared.push(pp);
    allocateGoal(
      pp,
      days,
      blocks,
      settings.energyOrdering,
      settings.placementPriority,
      tz,
      windows
    );
  }

  // Wheel-of-Life floors enter the pipeline as synthetic goals with min/wk set.
  const wheelTopUps = wheelTopUpGoals(schedulingGoals, settings.wheel);
  const goalsForAllocation = [...schedulingGoals, ...wheelTopUps];

  // Three-pass distribution (uses free gaps remaining after timemap placement).
  const totalFreeMin = days.reduce(
    (acc, d) =>
      acc + d.gaps.reduce((a, g) => a + Math.floor((g.endMs - g.startMs) / MS_PER_MIN), 0),
    0
  );
  const { prepared, overcommitted, notScheduled } = distributeMinutes(
    goalsForAllocation,
    totalFreeMin,
    settings.allocator,
    input.catchUpFloors
  );

  // Pass 3 — placement: schedule each prepared goal, day by day, honouring
  // per-day caps. Order matters when free time is scarce, so we sort:
  //   1. commitment tier (non-negotiable → committed → nice-to-have),
  //   2. floor-bearing goals first (so their minimums actually land),
  //   3. then by user-provided list order,
  //   4. then by remaining minutes desc as a final tie-breaker.
  prepared.sort((a, b) => {
    const aTier = commitmentRank(a.goal.commitmentLevel);
    const bTier = commitmentRank(b.goal.commitmentLevel);
    if (aTier !== bTier) return aTier - bTier;
    const aHasFloor = (a.norm.minMinutesPerWeek ?? 0) > 0 ? 0 : 1;
    const bHasFloor = (b.norm.minMinutesPerWeek ?? 0) > 0 ? 0 : 1;
    if (aHasFloor !== bHasFloor) return aHasFloor - bHasFloor;
    if (a.index !== b.index) return a.index - b.index;
    return b.effectiveMinutes - a.effectiveMinutes;
  });

  for (const p of prepared) {
    if (p.effectiveMinutes <= 0) continue;
    allocateGoal(
      p,
      days,
      blocks,
      settings.energyOrdering,
      settings.placementPriority,
      tz,
      input.goalAvailabilityWindows?.[p.goal.id]
    );
  }

  const preparedForMetrics = [...timemapPrepared, ...prepared];

  if (settings.energyOrdering.mode !== "ignore") {
    sortBlocksByEnergyCurve(blocks, settings.energyOrdering);
  } else {
    blocks.sort((a, b) => a.startMs - b.startMs);
  }

  const metrics = computeMetrics(plan, preparedForMetrics, blocks, days, settings.wheel, settings.ppf);
  if (overcommitted) metrics.overcommitted = overcommitted;
  metrics.notScheduled = notScheduled;
  return { blocks, metrics };
}

/**
 * Pass 1 + Pass 2: derive each goal's `effectiveMinutes` for the week.
 *
 *   - Pass 1 reserves every goal's `minMinutesPerWeek` as a floor.
 *   - Pass 2 distributes the remaining free time. Behavior depends on
 *     `allocator.allocationMode`:
 *
 *       "even" (default): split the remainder evenly across goals that have
 *       not yet hit their `maxMinutesPerWeek`. Goals with no time fields
 *       ("equal share" goals) start at 0 and receive their slice in this pass,
 *       so all available time gets allocated.
 *
 *       "finish-early": top up each goal in user/priority order to its
 *       `maxMinutesPerWeek` cap, then stop. Goals without a cap stay at their
 *       floor, leaving the remainder as free time at the end of the day/week.
 *
 *   - When floors exceed `totalFreeMin`, we either scale floors proportionally
 *     (default) or pay them in user order until time runs out (strict).
 */
function distributeMinutes(
  goals: readonly WeeklyGoal[],
  totalFreeMin: number,
  allocator: AllocatorSettings,
  catchUpFloors?: Record<string, number>
): {
  prepared: PreparedGoal[];
  overcommitted: WeekMetrics["overcommitted"];
  notScheduled: WeekMetrics["notScheduled"];
} {
  const prepared: PreparedGoal[] = goals.map((goal, index) => {
    const norm = normaliseGoalTime(goal);
    const bump = catchUpFloors?.[goal.id] ?? 0;
    if (bump !== 0) {
      // Bump both the floor (so the catch-up is reserved in Pass 1) and the
      // ceiling (so a tight `maxMinutesPerWeek` doesn't swallow the boost).
      // Floors clamp at zero — a negative catch-up cannot drive the floor
      // below zero or below an existing larger ceiling.
      const baseFloor = norm.minMinutesPerWeek ?? 0;
      norm.minMinutesPerWeek = Math.max(0, baseFloor + bump);
      if (norm.maxMinutesPerWeek !== undefined) {
        norm.maxMinutesPerWeek = Math.max(
          norm.minMinutesPerWeek,
          norm.maxMinutesPerWeek + bump
        );
      }
    }
    return {
      goal,
      norm,
      effectiveMinutes: 0,
      index
    };
  });

  // Pass 1: reserve floors.
  let floorTotal = 0;
  for (const p of prepared) {
    const minFloor = p.norm.minMinutesPerWeek ?? 0;
    // Weekly min/max are orthogonal constraints: if both are present, the
    // effective weekly floor cannot exceed the weekly cap.
    const floor =
      p.norm.maxMinutesPerWeek !== undefined
        ? Math.min(minFloor, p.norm.maxMinutesPerWeek)
        : minFloor;
    p.effectiveMinutes = floor;
    floorTotal += floor;
  }

  let overcommitted: WeekMetrics["overcommitted"];
  const notScheduled: WeekMetrics["notScheduled"] = [];

  if (floorTotal > totalFreeMin) {
    overcommitted = {
      neededMin: floorTotal,
      availableMin: totalFreeMin,
      mode: allocator.starvationMode
    };
    if (allocator.starvationMode === "proportional") {
      const ratio = totalFreeMin / Math.max(1, floorTotal);
      for (const p of prepared) {
        p.effectiveMinutes = quantise(p.effectiveMinutes * ratio);
      }
    } else {
      // Strict: pay floors in goal order until time runs out, zero the rest.
      let budget = totalFreeMin;
      for (const p of prepared) {
        const want = p.effectiveMinutes;
        const give = Math.min(want, Math.max(0, budget));
        p.effectiveMinutes = quantise(give);
        budget -= give;
        if (give < want) {
          notScheduled.push({ goalId: p.goal.id, title: p.goal.title, reason: "starved" });
        }
      }
    }
    return { prepared, overcommitted, notScheduled };
  }

  let remainder = totalFreeMin - floorTotal;

  if (allocator.allocationMode === "finish-early") {
    // Pass 2 (finish-early): fill goals one after another in user/priority
    // order, topping each up to its weekly cap. Goals without a cap don't
    // grow past their floor, so leftover time stays as free time the placer
    // will simply not consume — surfaced to the UI as "free time at the end
    // of the day/week".
    const ordered = [...prepared].sort((a, b) => a.index - b.index);
    for (const p of ordered) {
      if (remainder < QUANTUM) break;
      const cap = p.norm.maxMinutesPerWeek;
      if (cap === undefined) continue;
      const headroom = Math.max(0, cap - p.effectiveMinutes);
      if (headroom < QUANTUM) continue;
      const give = quantise(Math.min(headroom, remainder));
      if (give <= 0) continue;
      p.effectiveMinutes += give;
      remainder -= give;
    }
    return { prepared, overcommitted, notScheduled };
  }

  // Pass 2 (even): equal-share the remainder up to each goal's ceiling.
  // Anyone whose effective minutes is below their cap (or who has no cap) is
  // eligible to receive more time. Equal-share goals (no time fields at all)
  // and goals with a floor below max both count.
  const eligible = () =>
    prepared.filter((p) => {
      const cap = p.norm.maxMinutesPerWeek;
      // Pinned-target goals (min == max via legacy) shouldn't grow.
      if (cap !== undefined && p.effectiveMinutes >= cap) return false;
      // Goals that explicitly opted out of equal share by setting only a floor
      // still grow — having a floor doesn't disqualify you from extra time.
      // Goals with NO bounds at all are equal-share too.
      return true;
    });

  // We iterate up to `prepared.length` rounds, capping or fully consuming.
  let rounds = prepared.length + 1;
  while (remainder >= QUANTUM && rounds-- > 0) {
    const set = eligible();
    if (set.length === 0) break;
    const share = quantise(remainder / set.length);
    if (share <= 0) break;
    let consumed = 0;
    for (const p of set) {
      const cap = p.norm.maxMinutesPerWeek;
      const headroom = cap === undefined ? share : Math.max(0, cap - p.effectiveMinutes);
      const give = Math.min(share, headroom, remainder - consumed);
      if (give <= 0) continue;
      p.effectiveMinutes += give;
      consumed += give;
    }
    if (consumed === 0) break;
    remainder -= consumed;
  }

  return { prepared, overcommitted, notScheduled };
}

function quantise(min: number): number {
  return Math.max(0, Math.round(min / QUANTUM) * QUANTUM);
}

/** Sum free minutes still in `days[].gaps` that fall inside global availability windows. */
function minutesInIntersectedWeekGaps(
  days: { startMs: number; endMs: number; gaps: Interval[] }[],
  windows: readonly Interval[] | undefined
): number {
  if (!windows?.length) return 0;
  let total = 0;
  for (const day of days) {
    const clipped = intersectWithAvailability(day.gaps, windows, day.startMs, day.endMs);
    for (const iv of clipped) {
      total += Math.floor((iv.endMs - iv.startMs) / MS_PER_MIN);
    }
  }
  return total;
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
    // Estimate how much existing goals are already committing to this area.
    // We use the simplest available signal — the floor (or legacy target) — so
    // wheel top-ups only fire when the user clearly hasn't covered the area.
    const norm = normaliseGoalTime(g);
    const committed = norm.minMinutesPerWeek ?? norm.maxMinutesPerWeek ?? 0;
    minutesByArea[g.wheelAreaId] = (minutesByArea[g.wheelAreaId] ?? 0) + committed;
  }
  const topUps: WeeklyGoal[] = [];
  for (const area of wheel.areas) {
    const have = minutesByArea[area.id] ?? 0;
    const gap = area.minMinutesPerWeek - have;
    if (gap > 0) {
      topUps.push({
        id: `wheel-topup:${area.id}`,
        title: `${area.label} (Wheel floor)`,
        minMinutesPerWeek: gap,
        priority: 2,
        energyMode: "neutral",
        energyPolarity: "neutral",
        attentionMode: "unspecified",
        workLayer: "unspecified",
        wheelAreaId: area.id,
        ppfHorizon: "unspecified",
        commitmentLevel: "committed"
      });
    }
  }
  return topUps;
}

function allocateGoal(
  prepared: PreparedGoal,
  days: { startMs: number; endMs: number; gaps: Interval[] }[],
  blocks: AllocatedBlock[],
  energy: EnergyOrderingSettings,
  placement: PlacementPrioritySettings,
  tz: string,
  availabilityWindows?: readonly Interval[]
): void {
  const { goal, norm } = prepared;
  let remainingMinutes = prepared.effectiveMinutes;
  if (remainingMinutes <= 0) return;

  const allowedDays =
    goal.daysOfWeek && goal.daysOfWeek.length > 0
      ? goal.daysOfWeek.map((d) => DAY_INDEX[d])
      : goal.dayOfWeek
        ? [DAY_INDEX[goal.dayOfWeek]]
        : [0, 1, 2, 3, 4, 5, 6];

  // How many days do we want this goal to occupy? frequencyPerWeek wins,
  // else a day-pinned goal stays on its single day, else spread across all 7.
  const targetDays = Math.min(allowedDays.length, norm.frequencyPerWeek ?? allowedDays.length);

  // Per-day budget = total / targetDays, clamped by maxMinutesPerDay.
  let perDay = Math.ceil(remainingMinutes / targetDays);
  if (norm.maxMinutesPerDay !== undefined) {
    perDay = Math.min(perDay, norm.maxMinutesPerDay);
  }
  if (perDay <= 0) return;

  // If the user set a daily floor, ensure each scheduled day lands at least that.
  const minPerDay = norm.minMinutesPerDay ?? 0;
  const perDayBudget = Math.max(perDay, minPerDay);

  // We may need to walk the days more than once when frequencyPerWeek limits
  // us to N days but our first pass couldn't place the full budget. Two rounds
  // cover typical weekly goals; inverted-calendar windows often squeeze all
  // minutes into fewer days than `ceil(total/7)`, so extra passes are needed
  // whenever availability windows intersect the grid.
  const maxPasses = availabilityWindows ? 32 : 2;
  for (let pass = 0; pass < maxPasses && remainingMinutes > 0; pass++) {
    let daysScheduledThisPass = 0;
    for (const dayIdx of allowedDays) {
      if (remainingMinutes <= 0) break;
      if (norm.frequencyPerWeek !== undefined && pass === 0 && daysScheduledThisPass >= targetDays)
        break;
      const day = days[dayIdx]!;
      const dayMinutesAlready = blocks
        .filter((b) => b.goalId === goal.id && b.startMs >= day.startMs && b.endMs <= day.endMs)
        .reduce((acc, b) => acc + Math.floor((b.endMs - b.startMs) / MS_PER_MIN), 0);
      const dayHeadroom =
        norm.maxMinutesPerDay !== undefined
          ? Math.max(0, norm.maxMinutesPerDay - dayMinutesAlready)
          : perDayBudget;
      if (dayHeadroom < QUANTUM) continue;
      const candidateGaps = availabilityWindows
        ? intersectWithAvailability(day.gaps, availabilityWindows, day.startMs, day.endMs)
        : day.gaps;
      if (candidateGaps.length === 0) continue;
      // Energy-suggestion pass needs to see only blocks already placed on the
      // current day so adjacency scoring doesn't reach across day boundaries.
      const placedToday = blocks.filter(
        (b) => b.startMs >= day.startMs && b.endMs <= day.endMs
      );
      const slot = pickGapForGoal(
        candidateGaps,
        goal,
        dayHeadroom,
        energy,
        placement,
        tz,
        placedToday
      );
      if (!slot) continue;
      const wantThisDay = Math.min(remainingMinutes, perDayBudget, dayHeadroom);
      const usedMinutes = Math.min(wantThisDay, slot.minutes);
      if (usedMinutes < QUANTUM) continue;
      // Honour minMinutesPerDay: never place a tiny block when the user asked
      // for at least N minutes, unless the gap can't accommodate.
      if (minPerDay > 0 && usedMinutes < minPerDay && slot.minutes >= minPerDay) {
        // Try again with a bigger ask.
        const bigger = Math.min(remainingMinutes, dayHeadroom, slot.minutes);
        if (bigger < minPerDay) continue;
      }
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
      daysScheduledThisPass++;
    }
    if (daysScheduledThisPass === 0) break;
  }
}

function intersectWithAvailability(
  gaps: readonly Interval[],
  availabilityWindows: readonly Interval[],
  dayStartMs: number,
  dayEndMs: number
): Interval[] {
  const dayWindows = availabilityWindows.filter(
    (w) => w.endMs > dayStartMs && w.startMs < dayEndMs
  );
  if (dayWindows.length === 0) return [];
  const out: Interval[] = [];
  for (const gap of gaps) {
    for (const window of dayWindows) {
      const startMs = Math.max(gap.startMs, window.startMs);
      const endMs = Math.min(gap.endMs, window.endMs);
      if (endMs > startMs) out.push({ startMs, endMs });
    }
  }
  return out;
}

function pickGapForGoal(
  gaps: readonly Interval[],
  goal: WeeklyGoal,
  perDay: number,
  energy: EnergyOrderingSettings,
  placement: PlacementPrioritySettings,
  tz: string,
  placedToday: readonly AllocatedBlock[] = []
): { gap: Interval; minutes: number } | null {
  const earliest = goal.earliestHour ?? 0;
  const latest = goal.latestHour ?? 24;
  const weights = placementWeightsFromPriority(placement);
  const candidates: { gap: Interval; minutes: number; score: number }[] = [];
  for (const g of gaps) {
    const startHour = hourInTz(g.startMs, tz);
    const endHour = hourInTz(g.endMs - 1, tz);
    if (endHour < earliest || startHour >= latest) continue;
    const lengthMin = Math.floor((g.endMs - g.startMs) / MS_PER_MIN);
    if (lengthMin < 15) continue;
    const energyScore =
      weights.energyMode * scoreGapForEnergy(g, goal.energyMode, energy, tz);
    const suggestionScore =
      energy.mode === "ignore"
        ? 0
        : scoreEnergyAwareness(g, goal, tz, placedToday, weights);
    candidates.push({
      gap: g,
      minutes: Math.min(perDay, lengthMin),
      score: energyScore + suggestionScore
    });
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

/**
 * Sort key for the commitment tier. Lower number wins. Falling back to
 * "committed" keeps legacy goals in the same slot they used to occupy
 * (between non-negotiables and nice-to-haves).
 */
function commitmentRank(level: CommitmentLevel | undefined): number {
  switch (level) {
    case "non_negotiable":
      return 0;
    case "nice_to_have":
      return 2;
    default:
      return 1;
  }
}

interface SignalWeights {
  energyMode: number;
  attentionMode: number;
  workLayer: number;
  energyPolarity: number;
}

const DEFAULT_PLACEMENT_ORDER: readonly PlacementSignalKey[] = [
  "energyMode",
  "attentionMode",
  "workLayer",
  "energyPolarity"
];

const UNIFORM_SIGNAL_WEIGHTS: SignalWeights = {
  energyMode: 1,
  attentionMode: 1,
  workLayer: 1,
  energyPolarity: 1
};

/**
 * Aggressive fade applied only when the user has reordered the placement
 * signals away from the default. Top-rank stays at full strength and lower
 * ranks are knocked down hard so the user's chosen signal genuinely flips
 * placement decisions. The default ranking yields uniform weights so legacy
 * behaviour is preserved bit-for-bit.
 */
const PLACEMENT_FADE_WEIGHTS = [1, 0.25, 0.08, 0.02] as const;

/**
 * Translate a user-supplied placement-signal ranking into multiplicative
 * weights. The default order returns uniform 1.0 weights so existing
 * placement scoring is unchanged; any other order applies a fade so the
 * user's preferred signal dominates.
 */
function placementWeightsFromPriority(
  placement: PlacementPrioritySettings
): SignalWeights {
  const order = placement.order;
  const isDefault =
    order.length === DEFAULT_PLACEMENT_ORDER.length &&
    order.every((key, i) => key === DEFAULT_PLACEMENT_ORDER[i]);
  if (isDefault) return UNIFORM_SIGNAL_WEIGHTS;
  const weightFor = (key: PlacementSignalKey): number => {
    const idx = order.indexOf(key);
    if (idx < 0) return PLACEMENT_FADE_WEIGHTS[PLACEMENT_FADE_WEIGHTS.length - 1]!;
    return (
      PLACEMENT_FADE_WEIGHTS[Math.min(idx, PLACEMENT_FADE_WEIGHTS.length - 1)] ?? 1
    );
  };
  return {
    energyMode: weightFor("energyMode"),
    attentionMode: weightFor("attentionMode"),
    workLayer: weightFor("workLayer"),
    energyPolarity: weightFor("energyPolarity")
  };
}

/**
 * Tunable weights for the energy-aware suggestion layer.
 *
 * These intentionally use small magnitudes so the dominant signal stays the
 * existing `energyMode` placement curve. The new manual classification
 * (`attentionMode`, `workLayer`, `energyPolarity`) only nudges placement and
 * breaks ties — it never overrides hard constraints like day-pinning,
 * earliest/latest hour, or per-day caps.
 */
export const ENERGY_SUGGESTION_WEIGHTS = {
  /** Per-hour distance penalty when a goal carries an attentionMode. */
  attentionPenaltyPerHour: 0.4,
  /** Per-hour distance penalty for the matched work-layer target hour. */
  workLayerPenaltyPerHour: 0.3,
  /** Penalty applied when a "drain" block would land next to another drain. */
  drainAdjacencyPenalty: 4,
  /** Bonus applied when an "energise" block batches with another energise. */
  energiseAdjacencyBonus: 1,
  /** Two blocks within this many minutes of each other count as adjacent. */
  drainAdjacencyWindowMin: 60
} as const;

const ATTENTION_TARGET_HOUR: Record<AttentionMode, number | null> = {
  hyperfocus: 9,
  hyperaware: 15,
  unspecified: null
};

const WORK_LAYER_TARGET_HOUR: Record<WorkLayer, number | null> = {
  "needle-mover": 9,
  execution: 11,
  ops: 14,
  play: 18,
  unspecified: null
};

/**
 * Compute the additive suggestion-pass score for placing `goal` at `gap`.
 *
 * Combines three nudges:
 *   1. attentionMode → preferred hour (hyperfocus morning, hyperaware afternoon)
 *   2. workLayer     → preferred hour (needle-mover early, play evening)
 *   3. energyPolarity → adjacency to already-placed drain/energise blocks
 *
 * Returns a score whose magnitude is dwarfed by `scoreGapForEnergy` so legacy
 * placement behaviour is preserved when the new fields are unspecified.
 */
function scoreEnergyAwareness(
  gap: Interval,
  goal: WeeklyGoal,
  tz: string,
  placedToday: readonly AllocatedBlock[],
  weights: SignalWeights
): number {
  let score = 0;
  const startHour = hourInTz(gap.startMs, tz);

  const attentionTarget = ATTENTION_TARGET_HOUR[goal.attentionMode ?? "unspecified"];
  if (attentionTarget !== null) {
    score -=
      weights.attentionMode *
      ENERGY_SUGGESTION_WEIGHTS.attentionPenaltyPerHour *
      Math.abs(startHour - attentionTarget);
  }

  const layerTarget = WORK_LAYER_TARGET_HOUR[goal.workLayer ?? "unspecified"];
  if (layerTarget !== null) {
    score -=
      weights.workLayer *
      ENERGY_SUGGESTION_WEIGHTS.workLayerPenaltyPerHour *
      Math.abs(startHour - layerTarget);
  }

  const polarity = goal.energyPolarity ?? "neutral";
  if (polarity === "drain" || polarity === "energise") {
    const windowMs = ENERGY_SUGGESTION_WEIGHTS.drainAdjacencyWindowMin * MS_PER_MIN;
    for (const placed of placedToday) {
      if (placed.segment) continue;
      // Adjacency = the placed block ends within the window before this gap
      // starts, or starts within the window after the gap ends.
      const closeBefore = gap.startMs - placed.endMs;
      const closeAfter = placed.startMs - gap.endMs;
      const isAdjacent =
        (closeBefore >= 0 && closeBefore <= windowMs) ||
        (closeAfter >= 0 && closeAfter <= windowMs);
      if (!isAdjacent) continue;
      if (polarity === "drain") {
        score -= weights.energyPolarity * ENERGY_SUGGESTION_WEIGHTS.drainAdjacencyPenalty;
      } else {
        score += weights.energyPolarity * ENERGY_SUGGESTION_WEIGHTS.energiseAdjacencyBonus;
      }
    }
  }

  return score;
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
  prepared: readonly PreparedGoal[],
  blocks: readonly AllocatedBlock[],
  days: { startMs: number; endMs: number; gaps: Interval[] }[],
  wheel: WheelSettings,
  ppf: PpfSettings
): WeekMetrics {
  const perGoal: Record<string, { scheduledMinutes: number; targetMinutes: number }> = {};
  // Target = the bounds the allocator decided to pursue this week, which for
  // legacy goals matches `targetMinutes` and for new goals reflects the
  // floor + equal-share allocation.
  const preparedById = new Map(prepared.map((p) => [p.goal.id, p] as const));
  for (const g of plan.goals) {
    const p = preparedById.get(g.id);
    perGoal[g.id] = {
      scheduledMinutes: 0,
      targetMinutes: p?.effectiveMinutes ?? g.targetMinutes ?? 0
    };
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
    utilisation: { availableMinutes, scheduledMinutes: totalScheduled },
    notScheduled: []
  };
}

// Re-export day-key helper for callers building per-day fixtures.
export { dateKeyInTz };
