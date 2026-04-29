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
 *        - optional `scheduleInNiceWeather` when `niceWeatherWindows` is non-empty
 *        - the user's `energyOrdering.mode`
 *        - Wheel-of-Life weekly minute floors per area
 *        - PPF minimum-touches and minimum-percent targets
 *   4. Optionally spread slack inside each tight free window as equal gaps
 *      between goal runs when `allocator.allocationMode` is `"even"` (skipped
 *      for `"finish-early"` and when a window is mostly unused, e.g. inverted-
 *      calendar pockets). Weekly target minutes do not depend on this mode.
 *   5. Goals with `specialGoalType: "gym"` reserve an extra quantised band of
 *      `settings.gym.driveMinutes` on each side of the workout block (same
 *      default one-way drive as calendar gym legs) so nothing else stacks in
 *      the commute window. Gym goals are scheduled **before** other goals at
 *      the same commitment/floor tier so earlier list order cannot occupy
 *      those drive windows first.
 *   6. Within a day, sort blocks to preserve the energy curve
 *      (hyperfocus → neutral → hyperaware) when mode is "balanced" or "strict".
 *
 * The allocator returns both placed blocks and a metrics object with
 * adherence, balance, and PPF mix figures used by the dashboard UI.
 */

import type {
  AllocatorSettings,
  ConsistencySegment,
  EnergyOrderingSettings,
  Hp6HabitKey,
  PlacementPrioritySettings,
  PlacementSignalKey,
  PpfHorizonKey,
  PpfPillarKey,
  SchedulerFrameworkInclusion,
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
import { hourInTz, dateKeyInTz, localMidnightMs } from "./time";

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

/** Stable drag override key for week-scoped goal blocks (calendar DnD). */
export function buildGoalDragKey(goalId: string, weekAnchorDate: string, slotIndex: number): string {
  return `goal:${weekAnchorDate}:${slotIndex}:${goalId}`;
}

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
  /**
   * Stable key for calendar drag overrides (`kind: "goal"` on WeeklyPlan.overrides).
   * Format: `goal:<weekAnchorIso>:<slotIndex>:<goalId>`.
   */
  dragKey?: string;
  /** True when placement used persisted override times for `dragKey`. */
  pinnedFromOverride?: boolean;
  /** True when `WeeklyPlan.overrides` still contains this `dragKey` (reset clears). */
  dragOverrideSaved?: boolean;
  /** How the slot was fixed in the plan (`drag` vs day-sheet `actual`) when `dragOverrideSaved`. */
  overrideSource?: "drag" | "actual";
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
  /**
   * HP6 habits below the derived weekly touch floor (monthly minimum ÷ 4, rounded up).
   * Empty when HP6 is excluded from the scheduler or all minimums are zero.
   */
  hp6Gaps: Array<{ habit: Hp6HabitKey; scheduledTouches: number; minTouches: number }>;
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
   * Optional merged "[Outside]" / nice-weather intervals for the allocation
   * window (`weekStartMs`..`weekEndMs`). Goals with `scheduleInNiceWeather`
   * intersect free gaps with these windows when the array is non-empty.
   */
  niceWeatherWindows?: readonly Interval[];
  /**
   * Optional per-goal catch-up adjustments in minutes.
   *
   * When the user is behind on a goal mid-week, the weekly review surface
   * computes a deficit and stores it here as `goalId -> additionalMinutes`.
   * The allocator adds these minutes to the goal's effective weekly floor so
   * the remaining days prioritise extra time — the user's `maxMinutesPerWeek`
   * (if any) stays a hard ceiling and is not raised by catch-up.
   *
   * Negative values are honoured (you can shrink a goal that ran ahead).
   * Missing or zero entries are no-ops, preserving baseline behaviour.
   */
  catchUpFloors?: Record<string, number>;
  /**
   * Monday ISO date (`YYYY-MM-DD`) identifying which weekly allocation window this
   * run represents—must align with `weekStartMs` so goal drag keys do not collide
   * across adjacent weeks. Defaults to `plan.weekStart`.
   */
  weekAnchorDate?: string;
  /**
   * Optional map of goal override `dragKey` → source (`drag` vs day-sheet `actual`).
   * `actual` pins relax free-gap containment so logged times win over auto-placement.
   */
  goalOverrideSources?: ReadonlyMap<string, "drag" | "actual">;
  /**
   * When set, auto-placed goal blocks (not pins) must end strictly after this
   * instant — purely-past proposals are skipped so minutes can land later in
   * the week. Omitted preserves legacy behaviour (tests / historical replay).
   */
  nowMs?: number;
  /**
   * Computed sleep windows (same intervals folded into `busy` as system sleep
   * blocks). Used so `source: "actual"` goal pins still cannot sit on sleep even
   * when gap constraints are relaxed for calendar busy.
   */
  sleepIntervals?: readonly Interval[];
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
  const { plan, busy, settings, sleepIntervals } = input;
  const tz = plan.timezone || settings.timezone;
  const weekStartMs = input.weekStartMs ?? parseLocalDateMs(plan.weekStart, tz);
  const weekEndMs = input.weekEndMs ?? weekStartMs + 7 * DAY_MS;
  const weekAnchorDate = input.weekAnchorDate ?? plan.weekStart;
  const goalOverrideSources =
    input.goalOverrideSources ?? goalOverrideSourcesFromPlan(plan);
  const allocationNowMs = input.nowMs;
  const goalOverrides = new Map<string, { startMs: number; endMs: number }>();
  for (const o of plan.overrides ?? []) {
    if (o.kind === "goal") goalOverrides.set(o.key, { startMs: o.startMs, endMs: o.endMs });
  }

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
  const fw = settings.schedulerFrameworkInclusion;

  // Wheel-of-Life floors enter the pipeline as synthetic goals with min/wk set.
  const wheelTopUps = wheelTopUpGoals(schedulingGoals, settings.wheel, fw.wheel);
  const goalsForAllocation = [...schedulingGoals, ...wheelTopUps];

  // Three-pass distribution.
  const totalFreeMin = days.reduce(
    (acc, d) => acc + d.gaps.reduce((a, g) => a + intervalMinutesFromNow(g, allocationNowMs), 0),
    0
  );
  const { prepared, overcommitted, notScheduled } = distributeMinutes(
    goalsForAllocation,
    totalFreeMin,
    settings.allocator,
    input.catchUpFloors
  );

  /** Free gaps after segments, before goals — used to even out inter-goal slack in "even" mode. */
  const gapsBeforeGoals = days.map((d) => d.gaps.map((g) => ({ ...g })));

  // Pass 3 — placement: schedule each prepared goal, day by day, honouring
  // per-day caps. Order matters when free time is scarce, so we sort:
  //   1. commitment tier (non-negotiable → committed → nice-to-have),
  //   2. floor-bearing goals first (so their minimums actually land),
  //   3. gym goals next (they consume drive pads — must run before fillers),
  //   4. then by user-provided list order,
  //   5. then by remaining minutes desc as a final tie-breaker.
  prepared.sort((a, b) => {
    if (fw.commitment) {
      const aTier = commitmentRank(a.goal.commitmentLevel);
      const bTier = commitmentRank(b.goal.commitmentLevel);
      if (aTier !== bTier) return aTier - bTier;
    }
    const aHasFloor = (a.norm.minMinutesPerWeek ?? 0) > 0 ? 0 : 1;
    const bHasFloor = (b.norm.minMinutesPerWeek ?? 0) > 0 ? 0 : 1;
    if (aHasFloor !== bHasFloor) return aHasFloor - bHasFloor;
    const aGym = a.goal.specialGoalType === "gym" ? 0 : 1;
    const bGym = b.goal.specialGoalType === "gym" ? 0 : 1;
    if (aGym !== bGym) return aGym - bGym;
    if (a.index !== b.index) return a.index - b.index;
    return b.effectiveMinutes - a.effectiveMinutes;
  });

  for (const p of prepared) {
    if (p.effectiveMinutes <= 0) continue;
    allocateGoal(
      p,
      days,
      blocks,
      busy,
      settings.energyOrdering,
      settings.placementPriority,
      fw,
      tz,
      settings,
      input.goalAvailabilityWindows?.[p.goal.id],
      input.niceWeatherWindows,
      weekStartMs,
      weekEndMs,
      weekAnchorDate,
      goalOverrides,
      goalOverrideSources,
      allocationNowMs,
      sleepIntervals
    );
  }

  for (const b of blocks) {
    if (!b.dragKey || b.segment) continue;
    if (goalOverrides.has(b.dragKey)) {
      b.dragOverrideSaved = true;
      b.overrideSource = goalOverrideSources.get(b.dragKey) ?? "drag";
    }
  }

  if (settings.allocator.allocationMode === "even") {
    spreadEvenGoalBuffersInSnapshotGaps(blocks, gapsBeforeGoals);
  }

  if (settings.energyOrdering.mode !== "ignore") {
    sortBlocksByEnergyCurve(blocks, settings.energyOrdering);
  } else {
    blocks.sort((a, b) => a.startMs - b.startMs);
  }

  const metrics = computeMetrics(plan, prepared, blocks, days, settings, allocationNowMs);
  if (overcommitted) metrics.overcommitted = overcommitted;
  metrics.notScheduled = notScheduled;
  return { blocks, metrics };
}

/**
 * Pass 1 + Pass 2: derive each goal's `effectiveMinutes` for the week.
 *
 *   - Pass 1 reserves every goal's `minMinutesPerWeek` as a floor.
 *   - Pass 2 distributes the remaining free time: weighted share of the
 *     remainder (`allocationSharePercent` plus equal split for goals without
 *     it), respecting caps. Goals with a positive weekly floor do not
 *     participate in this pass unless they explicitly set
 *     `allocationSharePercent` (so "min" behaves as a floor, not floor+bonus).
 *     Calendar layout then uses `allocator.allocationMode`
 *     only: `"even"` spreads slack inside each free window as gaps between goal
 *     runs; `"finish-early"` leaves blocks packed without that padding so
 *     leftover time stays toward the end of the window.
 *
 *   - When floors exceed `totalFreeMin`, we either scale floors proportionally
 *     (default) or pay them in user order until time runs out (strict).
 */

/** Weight each goal's Pass 2 share of post-floor remainder (even allocation mode). */
export function computeAllocationRemainderFractions(goals: readonly WeeklyGoal[]): number[] {
  const n = goals.length;
  if (n === 0) return [];

  const fractions = Array<number>(n).fill(0);
  const pctIndices: number[] = [];
  const pctRaw: number[] = [];

  for (let i = 0; i < n; i++) {
    const pct = goals[i]!.allocationSharePercent;
    if (pct !== undefined) {
      pctIndices.push(i);
      pctRaw.push(pct);
    }
  }

  if (pctIndices.length > 0) {
    let sumPct = 0;
    for (const p of pctRaw) sumPct += p;
    const scaleDown = sumPct > 100 ? 100 / sumPct : 1;
    for (let j = 0; j < pctIndices.length; j++) {
      const idx = pctIndices[j]!;
      fractions[idx] = (pctRaw[j]! * scaleDown) / 100;
    }
  }

  let sumFracPct = 0;
  for (const idx of pctIndices) sumFracPct += fractions[idx]!;

  const eqIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (goals[i]!.allocationSharePercent === undefined) eqIndices.push(i);
  }

  const rest = 1 - sumFracPct;
  if (eqIndices.length > 0) {
    const share = rest / eqIndices.length;
    for (const i of eqIndices) fractions[i] = share;
  } else {
    const total = fractions.reduce((a, b) => a + b, 0);
    if (total > 1e-12 && Math.abs(total - 1) > 1e-9) {
      for (let i = 0; i < n; i++) {
        fractions[i] = fractions[i]! / total;
      }
    }
  }

  return fractions;
}

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
      // Floor only. Raising the weekly ceiling here made allocations exceed a
      // stated `maxMinutesPerWeek` (catch-up looked like "ignore my cap").
      const baseFloor = norm.minMinutesPerWeek ?? 0;
      norm.minMinutesPerWeek = Math.max(0, baseFloor + bump);
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

  // Pass 2: weighted share of the remainder (allocationSharePercent + equal split
  // for goals without it), then rounds respect caps / spillover. Packing/buffers
  // on the calendar are controlled separately via `allocator.allocationMode`.
  const remainderFractions = computeAllocationRemainderFractions(goals);

  const eligible = () =>
    prepared.filter((p) => {
      const cap = p.norm.maxMinutesPerWeek;
      if (cap !== undefined && p.effectiveMinutes >= cap) return false;
      const floor = p.norm.minMinutesPerWeek ?? 0;
      if (floor > 0 && p.goal.allocationSharePercent === undefined) return false;
      return true;
    });

  let rounds = prepared.length + 1;
  while (remainder >= QUANTUM && rounds-- > 0) {
    const set = eligible();
    if (set.length === 0) break;
    let sumW = 0;
    for (const p of set) sumW += remainderFractions[p.index]!;
    const useEqual = sumW <= 1e-12;
    let consumed = 0;
    for (const p of set) {
      const unit =
        useEqual ? 1 / set.length : remainderFractions[p.index]! / sumW;
      const cap = p.norm.maxMinutesPerWeek;
      const share = quantise(remainder * unit);
      if (share <= 0) continue;
      const headroom =
        cap === undefined ? share : Math.max(0, cap - p.effectiveMinutes);
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

function intervalMinutesFromNow(interval: Interval, nowMs: number | undefined): number {
  const startMs = nowMs === undefined ? interval.startMs : Math.max(interval.startMs, nowMs);
  if (interval.endMs <= startMs) return 0;
  return Math.floor((interval.endMs - startMs) / MS_PER_MIN);
}

/**
 * One-way drive padding (minutes) for gym-type weekly goals, rounded to the
 * same 15-minute grid as placement. Exported for calendar travel overlays.
 */
export function gymTravelPadMinutesForGoal(
  goal: Pick<WeeklyGoal, "specialGoalType">,
  gym: Pick<UserSettings["gym"], "driveMinutes">
): number {
  if (goal.specialGoalType !== "gym") return 0;
  return quantise(Math.max(0, gym.driveMinutes));
}

/**
 * Within each original free gap (post-segment snapshot), split slack evenly as
 * padding before the first goal run, between runs of different goals, and
 * after the last run. Blocks inside a run keep their relative packing.
 *
 * This intentionally introduces visible "breathing room" between goal runs in
 * `"even"` packing mode — not fragmentation from placement bugs.
 */
function spreadEvenGoalBuffersInSnapshotGaps(
  blocks: AllocatedBlock[],
  snapshot: readonly Interval[][]
): void {
  for (const dayGaps of snapshot) {
    for (const G of dayGaps) {
      const inside = blocks.filter(
        (b) =>
          !b.segment &&
          b.startMs >= G.startMs &&
          b.endMs <= G.endMs &&
          b.startMs < b.endMs
      );
      if (inside.length === 0) continue;
      // User-dragged / day-sheet pins must stay put; spreading slack would
      // reflow "floating" goals *and* shift locked blocks within the same gap.
      if (inside.some((b) => b.pinnedFromOverride || b.dragOverrideSaved || b.overrideSource)) continue;
      inside.sort((a, b) => a.startMs - b.startMs);
      const runs: { goalId: string; items: AllocatedBlock[] }[] = [];
      for (const b of inside) {
        const last = runs[runs.length - 1];
        if (last && last.goalId === b.goalId) last.items.push(b);
        else runs.push({ goalId: b.goalId, items: [b] });
      }
      let totalDur = 0;
      for (const b of inside) totalDur += b.endMs - b.startMs;
      const span = G.endMs - G.startMs;
      const slackMs = span - totalDur;
      if (slackMs < QUANTUM * MS_PER_MIN) continue;
      // Skip gaps where goals only occupy a small pocket (e.g. inverted-calendar
      // windows inside a full-day free snapshot) — spreading across the whole
      // snapshot would violate those bounds.
      if (slackMs > span * 0.7) continue;
      const k = runs.length;
      const rawPad = slackMs / (k + 1);
      let cursor = G.startMs + rawPad;
      for (const run of runs) {
        for (const b of run.items) {
          const dur = b.endMs - b.startMs;
          b.startMs = cursor;
          b.endMs = cursor + dur;
          cursor = b.endMs;
        }
        cursor += rawPad;
      }
    }
  }
}

/* ──────────────────────────── helpers ───────────────────────────────────── */

function parseLocalDateMs(dateStr: string, timeZone: string): number {
  const parts = dateStr.split("-").map(Number) as [number, number, number];
  return localMidnightMs(parts[0], parts[1], parts[2], timeZone);
}

/** Map goal drag keys to override source for relaxed day-sheet pins. */
export function goalOverrideSourcesFromPlan(plan: WeeklyPlan): Map<string, "drag" | "actual"> {
  const m = new Map<string, "drag" | "actual">();
  for (const o of plan.overrides ?? []) {
    if (o.kind === "goal") m.set(o.key, o.source ?? "drag");
  }
  return m;
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
  wheel: WheelSettings,
  wheelFrameworkInScheduler: boolean
): WeeklyGoal[] {
  if (!wheelFrameworkInScheduler) return [];
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

function dayIndexForMsInWeek(ms: number, weekStartMs: number, tz: string): number {
  const dk = dateKeyInTz(ms, tz);
  for (let d = 0; d < 7; d++) {
    const ds = weekStartMs + d * DAY_MS;
    if (dateKeyInTz(ds, tz) === dk) return d;
  }
  return -1;
}

/** True when [innerStart, innerEnd) lies contiguously inside the union of free gaps. */
/** Intersects free gaps with optional invert-calendar windows, then nice-weather outside windows. */
function placementWindowsForDay(
  dayGaps: readonly Interval[],
  dayStartMs: number,
  dayEndMs: number,
  availabilityWindows: readonly Interval[] | undefined,
  niceWeatherWindows: readonly Interval[] | undefined,
  goal: WeeklyGoal
): Interval[] {
  let gaps: Interval[] = dayGaps as Interval[];
  if (availabilityWindows && availabilityWindows.length > 0) {
    gaps = intersectWithAvailability(gaps, availabilityWindows, dayStartMs, dayEndMs);
  }
  if (
    goal.scheduleInNiceWeather === true &&
    niceWeatherWindows &&
    niceWeatherWindows.length > 0
  ) {
    gaps = intersectWithAvailability(gaps, niceWeatherWindows, dayStartMs, dayEndMs);
  }
  return gaps;
}

function intervalFullyInsideGaps(gaps: readonly Interval[], innerStart: number, innerEnd: number): boolean {
  if (innerEnd <= innerStart) return false;
  let t = innerStart;
  const sorted = [...gaps].sort((a, b) => a.startMs - b.startMs);
  for (const g of sorted) {
    if (g.endMs <= t) continue;
    if (g.startMs > t) return false;
    t = Math.max(t, g.endMs);
    if (t >= innerEnd) return true;
  }
  return t >= innerEnd;
}

function pinOverlapsSegmentBlocks(blocks: readonly AllocatedBlock[], innerStart: number, innerEnd: number): boolean {
  for (const b of blocks) {
    if (!b.segment) continue;
    if (innerStart < b.endMs && innerEnd > b.startMs) return true;
  }
  return false;
}

function pinOverlapsSleep(innerStart: number, innerEnd: number, sleep: readonly Interval[] | undefined): boolean {
  if (!sleep || sleep.length === 0) return false;
  for (const s of sleep) {
    if (innerStart < s.endMs && innerEnd > s.startMs) return true;
  }
  return false;
}

function tryPinGoalBlock(
  pinned: { startMs: number; endMs: number },
  dragKey: string,
  goal: WeeklyGoal,
  day: { startMs: number; endMs: number; gaps: Interval[] },
  blocks: AllocatedBlock[],
  tz: string,
  gymTravelPadMs: number,
  availabilityWindows: readonly Interval[] | undefined,
  niceWeatherWindows: readonly Interval[] | undefined,
  weekStartMs: number,
  weekEndMs: number,
  dayHeadroom: number,
  remainingMinutes: number,
  relaxGapConstraints: boolean,
  sleepIntervals: readonly Interval[] | undefined
): number | null {
  let startMs = Math.max(pinned.startMs, weekStartMs);
  let endMs = Math.min(pinned.endMs, weekEndMs);
  if (endMs <= startMs) return null;

  let durMin = Math.round((endMs - startMs) / MS_PER_MIN);
  durMin = Math.max(QUANTUM, Math.round(durMin / QUANTUM) * QUANTUM);
  endMs = startMs + durMin * MS_PER_MIN;
  if (endMs > weekEndMs) return null;

  if (dateKeyInTz(startMs, tz) !== dateKeyInTz(day.startMs, tz)) return null;

  const earliest = goal.earliestHour ?? 0;
  const latest = goal.latestHour ?? 24;
  const startHour = hourInTz(startMs, tz);
  const endHourLast = hourInTz(endMs - 1, tz);
  if (startHour < earliest || endHourLast >= latest) return null;

  if (durMin > dayHeadroom || durMin > remainingMinutes) return null;

  const consumeStart = startMs - gymTravelPadMs;
  const consumeEnd = endMs + gymTravelPadMs;

  if (relaxGapConstraints) {
    if (pinOverlapsSegmentBlocks(blocks, consumeStart, consumeEnd)) {
      return null;
    }
    if (pinOverlapsSleep(consumeStart, consumeEnd, sleepIntervals)) {
      return null;
    }
  } else {
    const candidateGaps = placementWindowsForDay(
      day.gaps,
      day.startMs,
      day.endMs,
      availabilityWindows,
      niceWeatherWindows,
      goal
    );
    if (
      !intervalFullyInsideGaps(candidateGaps, startMs, endMs) ||
      !intervalFullyInsideGaps(day.gaps, consumeStart, consumeEnd)
    ) {
      return null;
    }
  }
  consumeFromGaps(day.gaps, consumeStart, consumeEnd);
  blocks.push({
    goalId: goal.id,
    title: goal.title,
    startMs,
    endMs,
    energyMode: goal.energyMode,
    ...(goal.wheelAreaId !== undefined ? { wheelAreaId: goal.wheelAreaId } : {}),
    ...(goal.ppfPillar !== undefined ? { ppfPillar: goal.ppfPillar } : {}),
    ...(goal.hp6Habit !== undefined ? { hp6Habit: goal.hp6Habit } : {}),
    dragKey,
    pinnedFromOverride: true
  });
  return durMin;
}

function allocateGoal(
  prepared: PreparedGoal,
  days: { startMs: number; endMs: number; gaps: Interval[] }[],
  blocks: AllocatedBlock[],
  busy: readonly BusyEvent[],
  energy: EnergyOrderingSettings,
  placement: PlacementPrioritySettings,
  frameworkInclusion: SchedulerFrameworkInclusion,
  tz: string,
  settings: UserSettings,
  availabilityWindows: readonly Interval[] | undefined,
  niceWeatherWindows: readonly Interval[] | undefined,
  weekStartMs: number,
  weekEndMs: number,
  weekAnchorDate: string,
  goalOverrides: ReadonlyMap<string, { startMs: number; endMs: number }>,
  goalOverrideSources: ReadonlyMap<string, "drag" | "actual">,
  nowMs: number | undefined,
  sleepIntervals: readonly Interval[] | undefined
): void {
  const { goal, norm } = prepared;
  let remainingMinutes = prepared.effectiveMinutes;
  if (remainingMinutes <= 0) return;

  const gymTravelPadMin = gymTravelPadMinutesForGoal(goal, settings.gym);
  const gymTravelPadMs = gymTravelPadMin * MS_PER_MIN;

  const allowedDays =
    goal.daysOfWeek && goal.daysOfWeek.length > 0
      ? goal.daysOfWeek.map((d) => DAY_INDEX[d])
      : goal.dayOfWeek
        ? [DAY_INDEX[goal.dayOfWeek]]
        : [0, 1, 2, 3, 4, 5, 6];

  // How many days do we want this goal to occupy? frequencyPerWeek wins,
  // else a day-pinned goal stays on its single day, else spread across all 7.
  const maxDaysForQuantum = Math.max(1, Math.floor(remainingMinutes / QUANTUM));
  const targetDays = Math.min(
    allowedDays.length,
    norm.frequencyPerWeek ?? allowedDays.length,
    maxDaysForQuantum
  );

  // Per-day budget = total / targetDays, clamped by maxMinutesPerDay.
  let perDay = Math.ceil(remainingMinutes / targetDays);
  if (norm.maxMinutesPerDay !== undefined) {
    perDay = Math.min(perDay, norm.maxMinutesPerDay);
  }
  if (perDay <= 0) return;

  // If the user set a daily floor, ensure each scheduled day lands at least that.
  const minPerDay = norm.minMinutesPerDay ?? 0;
  const perDayBudget = Math.max(perDay, minPerDay);

  let slotIndex = 0;
  /** Drag overrides that failed `tryPinGoalBlock` — treat as unpinned so we do not auto-place duplicates on later passes. */
  const ignoredGoalPinKeys = new Set<string>();

  // We may need to walk the days more than once when frequencyPerWeek limits
  // us to N days but our first pass couldn't place the full budget. Two rounds
  // cover typical weekly goals; inverted-calendar windows often squeeze all
  // minutes into fewer days than `ceil(total/7)`, so extra passes are needed
  // whenever availability windows intersect the grid.
  const needsExtraPasses =
    Boolean(availabilityWindows && availabilityWindows.length > 0) ||
    Boolean(
      goal.scheduleInNiceWeather === true &&
        niceWeatherWindows &&
        niceWeatherWindows.length > 0
    );
  const maxPasses = needsExtraPasses ? 32 : 2;
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
      const dayLoggedMinutes = loggedGoalBusyMinutesForDay(busy, goal.id, day.startMs, day.endMs);
      const dayHeadroom =
        norm.maxMinutesPerDay !== undefined
          ? Math.max(0, norm.maxMinutesPerDay - (dayMinutesAlready + dayLoggedMinutes))
          : Number.POSITIVE_INFINITY;
      if (dayHeadroom < QUANTUM) continue;

      const dragKey = buildGoalDragKey(goal.id, weekAnchorDate, slotIndex);
      const pinnedFromMap = goalOverrides.get(dragKey);
      const pinned =
        pinnedFromMap !== undefined && !ignoredGoalPinKeys.has(dragKey) ? pinnedFromMap : undefined;
      if (pinned !== undefined) {
        const ovDay = dayIndexForMsInWeek(pinned.startMs, weekStartMs, tz);
        if (ovDay >= 0 && ovDay !== dayIdx) continue;
        if (ovDay === dayIdx && ovDay >= 0) {
          const relaxGaps = goalOverrideSources.get(dragKey) === "actual";
          const pinMinutes = tryPinGoalBlock(
            pinned,
            dragKey,
            goal,
            day,
            blocks,
            tz,
            gymTravelPadMs,
            availabilityWindows,
            niceWeatherWindows,
            weekStartMs,
            weekEndMs,
            dayHeadroom,
            remainingMinutes,
            relaxGaps,
            sleepIntervals
          );
          if (pinMinutes !== null && pinMinutes >= QUANTUM) {
            remainingMinutes -= pinMinutes;
            slotIndex++;
            daysScheduledThisPass++;
            continue;
          }
          ignoredGoalPinKeys.add(dragKey);
        } else if (ovDay < 0) {
          ignoredGoalPinKeys.add(dragKey);
        }
      }

      const candidateGaps = placementWindowsForDay(
        day.gaps,
        day.startMs,
        day.endMs,
        availabilityWindows,
        niceWeatherWindows,
        goal
      );
      const futureCandidateGaps =
        nowMs === undefined
          ? candidateGaps
          : candidateGaps
              .map((g) => ({ startMs: Math.max(g.startMs, nowMs), endMs: g.endMs }))
              .filter((g) => g.endMs > g.startMs);
      if (futureCandidateGaps.length === 0) continue;
      // Energy-suggestion pass needs to see only blocks already placed on the
      // current day so adjacency scoring doesn't reach across day boundaries.
      const placedToday = blocks.filter(
        (b) => b.startMs >= day.startMs && b.endMs <= day.endMs
      );
      const slot = pickGapForGoal(
        futureCandidateGaps,
        goal,
        dayHeadroom,
        energy,
        placement,
        frameworkInclusion,
        tz,
        placedToday,
        gymTravelPadMin
      );
      if (!slot) continue;
      // First pass aims for an even spread. If some days cannot fit that budget,
      // later passes let minutes spill into other allowed days (unless the user
      // explicitly set frequency/max-per-day constraints).
      const preferEvenSplitThisPass =
        pass === 0 || norm.frequencyPerWeek !== undefined || norm.maxMinutesPerDay !== undefined;
      const targetThisDay = preferEvenSplitThisPass ? perDayBudget : remainingMinutes;
      const wantThisDay = Math.min(remainingMinutes, targetThisDay, dayHeadroom);
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
      const { startMs, endMs } = placeBlockInGap(slot.gap, ms, goal, tz, gymTravelPadMs);
      if (nowMs !== undefined && endMs <= nowMs) {
        continue;
      }
      const consumeStart = startMs - gymTravelPadMs;
      const consumeEnd = endMs + gymTravelPadMs;
      consumeFromGaps(day.gaps, consumeStart, consumeEnd);
      blocks.push({
        goalId: goal.id,
        title: goal.title,
        startMs,
        endMs,
        energyMode: goal.energyMode,
        ...(goal.wheelAreaId !== undefined ? { wheelAreaId: goal.wheelAreaId } : {}),
        ...(goal.ppfPillar !== undefined ? { ppfPillar: goal.ppfPillar } : {}),
        ...(goal.hp6Habit !== undefined ? { hp6Habit: goal.hp6Habit } : {}),
        dragKey,
        pinnedFromOverride: false
      });
      remainingMinutes -= usedMinutes;
      slotIndex++;
      daysScheduledThisPass++;
    }
    if (daysScheduledThisPass === 0) break;
  }
  if (remainingMinutes >= QUANTUM && needsExtraPasses && remainingMinutes <= 8 * 60) {
    console.warn(
      `[allocateWeek] Goal "${goal.title}" (${goal.id}) has ${remainingMinutes} min unscheduled after ${maxPasses} passes (availability/nice-weather squeeze).`
    );
  }
}

function loggedGoalBusyMinutesForDay(
  busy: readonly BusyEvent[],
  goalId: string,
  dayStartMs: number,
  dayEndMs: number
): number {
  const prefix = `daysheet-goal:${goalId}:`;
  let total = 0;
  for (const ev of busy) {
    if (!ev.sourceId?.startsWith(prefix)) continue;
    const startMs = Math.max(ev.startMs, dayStartMs);
    const endMs = Math.min(ev.endMs, dayEndMs);
    if (endMs <= startMs) continue;
    total += Math.floor((endMs - startMs) / MS_PER_MIN);
  }
  return total;
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
  frameworkInclusion: SchedulerFrameworkInclusion,
  tz: string,
  placedToday: readonly AllocatedBlock[] = [],
  gymTravelPadMin = 0
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
    const innerMin =
      gymTravelPadMin > 0 ? lengthMin - 2 * gymTravelPadMin : lengthMin;
    if (innerMin < QUANTUM) continue;
    const energyScore =
      weights.energyMode * scoreGapForEnergy(g, goal.energyMode, energy, tz);
    const suggestionScore =
      energy.mode === "ignore"
        ? 0
        : scoreEnergyAwareness(g, goal, tz, placedToday, weights, frameworkInclusion);
    candidates.push({
      gap: g,
      minutes: Math.min(perDay, innerMin),
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

/** Prefer nearer-term goals earlier in the day; long-horizon later (weak signal). */
const PPF_HORIZON_TARGET_HOUR: Record<PpfHorizonKey, number | null> = {
  y1: 10,
  y3: 13,
  y5: 16,
  unspecified: null
};

const HP6_HABIT_KEYS: readonly Hp6HabitKey[] = [
  "clarity",
  "energy",
  "necessity",
  "productivity",
  "influence",
  "courage"
];

function hp6TouchesFromWeeklyMinMonthly(minMonthly: number): number {
  if (minMonthly <= 0) return 0;
  return Math.max(1, Math.ceil(minMonthly / 4));
}

function computeHp6Gaps(
  blocks: readonly AllocatedBlock[],
  settings: UserSettings,
  fw: SchedulerFrameworkInclusion
): WeekMetrics["hp6Gaps"] {
  if (!fw.hp6) return [];
  const out: WeekMetrics["hp6Gaps"] = [];
  /** Count allocator blocks touching each habit (one block = one weekly touch toward the floor). */
  const counts: Record<Hp6HabitKey, number> = {
    clarity: 0,
    energy: 0,
    necessity: 0,
    productivity: 0,
    influence: 0,
    courage: 0
  };
  for (const b of blocks) {
    if (b.segment) continue;
    if (b.segment) continue;
    const habitKey = b.hp6Habit as Hp6HabitKey | undefined;
    if (!habitKey) continue;
    counts[habitKey]++;
  }
  for (const habit of HP6_HABIT_KEYS) {
    const monthly = settings.hpp.hp6MinTouchesPerMonth[habit] ?? 0;
    const needed = hp6TouchesFromWeeklyMinMonthly(monthly);
    if (needed <= 0) continue;
    const scheduledTouches = counts[habit] ?? 0;
    if (scheduledTouches < needed) {
      out.push({
        habit,
        scheduledTouches,
        minTouches: needed
      });
    }
  }
  return out;
}

/**
 * Compute the additive suggestion-pass score for placing `goal` at `gap`.
 *
 * Combines nudges guarded by scheduler inclusion flags:
 *   1. attentionMode → preferred hour
 *   2. workLayer     → preferred hour
 *   3. ppfHorizon → weak hour tilt by horizon tier
 *   4. energyPolarity → adjacency to already-placed drain/energise blocks
 *
 * Returns a score whose magnitude is dwarfed by `scoreGapForEnergy` so legacy
 * placement behaviour is preserved when the new fields are unspecified.
 */
function scoreEnergyAwareness(
  gap: Interval,
  goal: WeeklyGoal,
  tz: string,
  placedToday: readonly AllocatedBlock[],
  weights: SignalWeights,
  frameworkInclusion: SchedulerFrameworkInclusion
): number {
  let score = 0;
  const startHour = hourInTz(gap.startMs, tz);

  if (frameworkInclusion.attention) {
    const attentionTarget = ATTENTION_TARGET_HOUR[goal.attentionMode ?? "unspecified"];
    if (attentionTarget !== null) {
      score -=
        weights.attentionMode *
        ENERGY_SUGGESTION_WEIGHTS.attentionPenaltyPerHour *
        Math.abs(startHour - attentionTarget);
    }
  }

  if (frameworkInclusion.workLayer) {
    const layerTarget = WORK_LAYER_TARGET_HOUR[goal.workLayer ?? "unspecified"];
    if (layerTarget !== null) {
      score -=
        weights.workLayer *
        ENERGY_SUGGESTION_WEIGHTS.workLayerPenaltyPerHour *
        Math.abs(startHour - layerTarget);
    }
  }

  /** Soft hour bias by horizon tier (weak nudge beneath energyMode curve). */
  if (frameworkInclusion.ppfHorizon) {
    const horizonTarget = PPF_HORIZON_TARGET_HOUR[goal.ppfHorizon ?? "unspecified"];
    if (horizonTarget !== null) {
      score -=
        weights.workLayer *
        ENERGY_SUGGESTION_WEIGHTS.workLayerPenaltyPerHour *
        0.35 *
        Math.abs(startHour - horizonTarget);
    }
  }

  const polarity = goal.energyPolarity ?? "neutral";
  if (
    frameworkInclusion.polarity &&
    (polarity === "drain" || polarity === "energise")
  ) {
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

function insetGapByPadding(gap: Interval, padMs: number): Interval | null {
  const startMs = gap.startMs + padMs;
  const endMs = gap.endMs - padMs;
  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

function placeBlockInGap(
  gap: Interval,
  ms: number,
  goal: WeeklyGoal,
  tz: string,
  travelPadMs = 0
): Interval {
  const inner =
    travelPadMs > 0 ? insetGapByPadding(gap, travelPadMs)! : gap;
  // Prefer the beginning of the gap if hyperfocus, end if hyperaware.
  if (goal.energyMode === "hyperaware") {
    const endMs = Math.min(inner.endMs, inner.startMs + (inner.endMs - inner.startMs));
    return { startMs: endMs - ms, endMs };
  }
  void tz;
  return { startMs: inner.startMs, endMs: inner.startMs + ms };
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
  settings: UserSettings,
  nowMs: number | undefined
): WeekMetrics {
  const wheel = settings.wheel;
  const ppf = settings.ppf;
  const fw = settings.schedulerFrameworkInclusion;
  const perGoal: Record<string, { scheduledMinutes: number; targetMinutes: number }> = {};
  // Target = the bounds the allocator decided to pursue this week, which for
  // legacy goals matches `targetMinutes` and for new goals reflects the
  // floor + equal-share of remaining weekly minutes (before calendar packing).
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

  const wheelGaps = fw.wheel
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
  if (fw.ppfPillar && ppf.enabled) {
    for (const t of ppf.targets) {
      if (t.minPercent > 0 && ppfPercent[t.pillar] < t.minPercent) {
        ppfGaps.push({ pillar: t.pillar, reason: "minPercent" });
      }
      if (t.minTouchesPerWeek > 0 && ppfTouches[t.pillar] < t.minTouchesPerWeek) {
        ppfGaps.push({ pillar: t.pillar, reason: "minTouches" });
      }
    }
  }

  const hp6Gaps = computeHp6Gaps(blocks, settings, fw);

  const availableMinutes = days.reduce(
    (acc, d) => acc + d.gaps.reduce((a, g) => a + intervalMinutesFromNow(g, nowMs), 0),
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
    hp6Gaps,
    utilisation: { availableMinutes, scheduledMinutes: totalScheduled },
    notScheduled: []
  };
}

// Re-export day-key helper for callers building per-day fixtures.
export { dateKeyInTz };
