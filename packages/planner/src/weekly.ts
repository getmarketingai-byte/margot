/**
 * Perfect-week allocator.
 *
 * Product/business rules: see [ALLOCATOR_BUSINESS_RULES.md](../ALLOCATOR_BUSINESS_RULES.md) in this package.
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
 *   5. Routines settings can inject a synthetic physical activity (`gym`) goal
 *      with optional ideal clock times.
 *      Physical activity reserves a quantised band of
 *      `settings.gym.driveMinutes` on each side of the workout block (same
 *      default one-way drive as calendar gym legs). That block is scheduled
 *      **before** other goals at the same commitment/floor tier so earlier list
 *      order cannot occupy those drive windows first. Optional
 *      `placementIdealClockTimes` bias gap choice and in-gap start alignment.
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
  GoalGroup,
  NormalisedGoalTime,
  PersonalSystem,
  WeeklyGoal,
  WeeklyPlan,
  WorkLayer
} from "@calendar-automations/schema";
import {
  effectiveEnergyBatteryProfile,
  filterSchedulingGoals,
  hydrateFrameworkSystemMirrors,
  isInvertedTimemapGoal,
  normaliseGoalTime,
  stubWeeklyGoalFromGoalGroup
} from "@calendar-automations/schema";
import type { BusyEvent, Interval } from "./types";
import { collectBusyIntervals, freeGaps, mergeIntervals } from "./intervals";
import { physicalActivityWeeklyGoalFromGymSettings } from "./weekly-routines";
import { hourInTz, dateKeyInTz, localMidnightMs } from "./time";

const MS_PER_MIN = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Reference waking-day busy proxy (14h) for normalising calendar load to 0–1. */
const DRAIN_REF_MS = 14 * 60 * MS_PER_MIN;
/** Round all minute decisions to a 15-minute grid. */
const QUANTUM = 15;

/** Next slot index for auto goal blocks so repeated Pass 3 invocations stay unique. */
function nextAutoGoalSlotIndex(
  blocks: readonly AllocatedBlock[],
  goalId: string,
  weekAnchorDate: string
): number {
  const suffix = `:${goalId}`;
  let max = -1;
  for (const b of blocks) {
    if (b.segment || b.goalId !== goalId || !b.dragKey?.endsWith(suffix)) continue;
    const parts = b.dragKey.split(":");
    if (parts.length < 4) continue;
    const n = Number(parts[2]);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max + 1;
}

const DAY_INDEX: Record<DayOfWeek, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6
};

/**
 * Per ISO week day (Mon = index 0): ratio of busy time to a reference ~14h waking day.
 * Used for personal energy / battery placement when enabled in settings.
 */
export function computeDayCalendarDrainScores(
  busy: readonly BusyEvent[],
  days: readonly { startMs: number; endMs: number }[]
): number[] {
  return days.map((day) => {
    let busyMs = 0;
    for (const ev of busy) {
      const start = Math.max(ev.startMs, day.startMs);
      const end = Math.min(ev.endMs, day.endMs);
      if (end > start) busyMs += end - start;
    }
    return Math.min(1, busyMs / DRAIN_REF_MS);
  });
}

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
  /**
   * goalId -> progress vs weekly plan.
   * - `targetMinutes`: Pass 1+2 planned weekly minutes (full-week free budget), before day-sheet credit.
   * - `scheduledMinutes`: achieved = merged union of day-sheet (`daysheet-goal:`) and goal block intervals (see ALLOCATOR_BUSINESS_RULES.md).
   * - `loggedMinutes` / `proposedFutureMinutes`: day-sheet-only and future-block-only (for UI); can overlap the same wall time, so they need not sum to `scheduledMinutes`.
   * - `unplacedMinutes`: placement demand after log credit still unmet by calendar blocks (>= 0).
   */
  perGoal: Record<
    string,
    {
      scheduledMinutes: number;
      targetMinutes: number;
      unplacedMinutes: number;
      /** Day-sheet (`daysheet-goal:`) minutes merged in the week window. */
      loggedMinutes: number;
      /** Allocator goal blocks from `now` through week end (merged); full week when `nowMs` omitted. */
      proposedFutureMinutes: number;
    }
  >;
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
  /** goalGroupId -> sum of member goals' achieved weekly minutes (same basis as `perGoal`). */
  goalGroupMinutes: Record<string, number>;
  /** Aggregate constraint violations (weekly shrink infeasibility, unmet floors, daily overrun). */
  goalGroupGaps: Array<{
    groupId: string;
    reason: "weeklyCap" | "weeklyFloor" | "dailyCap";
    shortMinutes: number;
    /** Present for `dailyCap` (Mon = 0). */
    dayIndex?: number;
  }>;
  /**
   * Capacity vs placement outcome.
   * - `weekCapacityMinutes`: schedulable gap total (per-day busy merged, incl. multi-day clips), after segments, before Pass 3.
   * - `weekCapacityFromNowMinutes`: same window clipped to `nowMs` before Pass 3.
   * - `availableMinutes`: free gaps left after placement, full week (no now-clip).
   * - `availableFromNowMinutes`: free gaps left after placement, clipped to `nowMs` when set.
   * - `scheduledMinutes`: sum of non-segment goal block minutes (PPF mix basis).
   * - `grossWeekMinutes`: length of the allocation window (usually 7×24h).
   * - `busyWeekMinutes`: time inside the window counted as busy (merged calendar
   *   + system blocks in `allocateWeek`’s `busy` input) before consistency segments.
   * - `consistencyReservedWeekMinutes`: minutes removed from open gaps by
   *   non-negotiable consistency segments (before Pass 3).
   * - `busyTrueEventCount`: `busy` events with `busy: true` in the merged feed.
   */
  utilisation: {
    weekCapacityMinutes: number;
    weekCapacityFromNowMinutes: number;
    availableMinutes: number;
    availableFromNowMinutes: number;
    scheduledMinutes: number;
    grossWeekMinutes: number;
    busyWeekMinutes: number;
    consistencyReservedWeekMinutes: number;
    busyTrueEventCount: number;
  };
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
  /**
   * Present when `UserSettings.personalSystem.energyBatterySchedulingEnabled` is true:
   * coarse calendar load per day + iterative tuning hints for the planning UI.
   */
  personalEnergyPlan?: {
    dayCalendarDrain: number[];
    tuningHints: string[];
  };
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
export interface PreparedGoal {
  goal: WeeklyGoal;
  norm: NormalisedGoalTime;
  /**
   * Weekly floor from `normaliseGoalTime` **before** `catchUpFloors` bump.
   * Pass 2 excludes goals with a positive **user** weekly floor and no `%`;
   * catch-up-only floors must still join equal-share remainder splitting.
   */
  weeklyFloorBeforeCatchUpBump: number;
  /** Pass 1+2 planned weekly minutes (full-week budget). */
  plannedWeeklyMinutes: number;
  /**
   * Minutes still to place after day-sheet credit (what Pass 3 tries to schedule).
   * Alias: placement demand.
   */
  effectiveMinutes: number;
  /** Order in the user's list, used as the priority tie-breaker. */
  index: number;
}

function isUnconstrainedEqualShareGoal(goal: WeeklyGoal, norm: NormalisedGoalTime): boolean {
  const onlyDailyMinimum =
    norm.minMinutesPerDay !== undefined &&
    norm.maxMinutesPerDay === undefined &&
    norm.minMinutesPerWeek === undefined &&
    norm.maxMinutesPerWeek === undefined &&
    goal.frequencyPerWeek === undefined &&
    goal.allocationSharePercent === undefined;
  return (
    (norm.isEqualShare || onlyDailyMinimum) &&
    goal.dayOfWeek === undefined &&
    (goal.daysOfWeek?.length ?? 0) === 0 &&
    goal.earliestHour === undefined &&
    goal.latestHour === undefined &&
    goal.scheduleInNiceWeather !== true &&
    goal.specialGoalType !== "gym" &&
    !(goal.placementIdealClockTimes && goal.placementIdealClockTimes.length > 0)
  );
}

export function allocateWeek(input: AllocateInput): AllocateResult {
  const { plan, busy, settings: incomingSettings, sleepIntervals } = input;
  const settings = hydrateFrameworkSystemMirrors(incomingSettings);
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
    const dayBusyRaw = collectBusyIntervals(busy, dayStart, dayEnd);
    const dayBusy = mergeIntervals(dayBusyRaw);
    days.push({ startMs: dayStart, endMs: dayEnd, gaps: freeGaps(dayStart, dayEnd, dayBusy) });
  }

  const grossWeekMinutes = Math.floor((weekEndMs - weekStartMs) / MS_PER_MIN);
  const minutesOpenBeforeConsistency = days.reduce(
    (acc, d) => acc + d.gaps.reduce((a, g) => a + intervalMinutesFull(g), 0),
    0
  );
  const busyWeekMinutes = Math.max(0, grossWeekMinutes - minutesOpenBeforeConsistency);
  const busyTrueEventCount = busy.filter((e) => e.busy).length;

  const blocks: AllocatedBlock[] = [];

  // Reserve non-negotiable segments first — they cannot be displaced by goals.
  if (settings.consistency.enabled) {
    for (const seg of settings.consistency.segments) {
      if (!seg.nonNegotiable) continue;
      reserveSegment(seg, days, weekStartMs, tz, blocks);
    }
  }

  const schedulingGoalsBase = plan.goals.filter((g) => !isInvertedTimemapGoal(g));
  const withoutRoutineInjected = schedulingGoalsBase.filter((g) => g.specialGoalType !== "gym");
  const physicalRoutine = physicalActivityWeeklyGoalFromGymSettings(settings.gym);
  const schedulingGoals = withoutRoutineInjected;
  const routineInject: WeeklyGoal[] = [];
  if (physicalRoutine) routineInject.push(physicalRoutine);
  const fw = settings.schedulerFrameworkInclusion;

  // Wheel-of-Life floors enter the pipeline as synthetic goals with min/wk set.
  const wheelTopUps = wheelTopUpGoals(
    [...schedulingGoals, ...routineInject],
    settings.wheel,
    fw.wheel
  );
  const goalsForAllocation = [...schedulingGoals, ...routineInject, ...wheelTopUps];

  const batteryOn = settings.personalSystem.energyBatterySchedulingEnabled === true;
  const dayDrainScores = batteryOn ? computeDayCalendarDrainScores(busy, days) : undefined;
  const batteryContext =
    batteryOn && dayDrainScores
      ? {
          goalsById: new Map(goalsForAllocation.map((g) => [g.id, g] as const)),
          dayDrainScores,
          personalSystem: settings.personalSystem
        }
      : undefined;

  // Pass 1+2: full ISO-week free gap total after segments (Mon–Sun window).
  // Pass 3 clips gaps to `allocationNowMs` when set, so placement demand for a
  // *mixed* goal cohort must not exceed `weekCapacityFromNowMinutes` or many
  // goals stall with unmeetable targets. (Unconstrained equal-share goals use
  // the specialised cap block below.)
  const weekCapacityMinutes = days.reduce(
    (acc, d) => acc + d.gaps.reduce((a, g) => a + intervalMinutesFull(g), 0),
    0
  );
  const consistencyReservedWeekMinutes = Math.max(
    0,
    minutesOpenBeforeConsistency - weekCapacityMinutes
  );
  const weekCapacityFromNowMinutes = days.reduce(
    (acc, d) => acc + d.gaps.reduce((a, g) => a + intervalMinutesFromNow(g, allocationNowMs), 0),
    0
  );
  const { prepared, overcommitted, notScheduled } = distributeMinutes(
    goalsForAllocation,
    weekCapacityMinutes,
    settings.allocator,
    input.catchUpFloors
  );

  const goalGroupWeeklyGapsPre: Array<{
    groupId: string;
    reason: "weeklyCap" | "weeklyFloor";
    shortMinutes: number;
  }> = [];
  applyGoalGroupWeeklyCaps(prepared, plan, weekCapacityMinutes, goalGroupWeeklyGapsPre);

  const groupPlacement = initGoalGroupPlacementContext(plan, busy, goalOverrides, days);

  // Logged day-sheet minutes should reduce remaining weekly demand for the same
  // goal. If those minutes are also represented as source="actual" pins, the
  // pin itself already consumes weekly demand, so only subtract unpinned logs.
  for (const p of prepared) {
    const weeklyLoggedMinutes = loggedGoalBusyMinutesForWindow(
      busy,
      p.goal.id,
      weekStartMs,
      weekEndMs
    );
    const weeklyPinnedActualMinutes = pinnedActualGoalOverrideMinutesForWindow(
      p.goal.id,
      weekStartMs,
      weekEndMs,
      goalOverrides,
      goalOverrideSources
    );
    const unpinnedLoggedMinutes = Math.max(0, weeklyLoggedMinutes - weeklyPinnedActualMinutes);
    p.effectiveMinutes = Math.max(0, p.effectiveMinutes - unpinnedLoggedMinutes);
  }

  if (allocationNowMs !== undefined) {
    const schedulable = prepared.filter((p) => p.effectiveMinutes > 0);
    const totalDemand = schedulable.reduce((acc, p) => acc + p.effectiveMinutes, 0);
    if (schedulable.length > 0 && totalDemand > weekCapacityFromNowMinutes) {
      const allUnconstrainedEqual = schedulable.every((p) =>
        isUnconstrainedEqualShareGoal(p.goal, p.norm)
      );
      if (allUnconstrainedEqual) {
        const budget = Math.max(0, weekCapacityFromNowMinutes);
        const originalDemand = new Map<PreparedGoal, number>(
          schedulable.map((p) => [p, p.effectiveMinutes] as const)
        );
        // Equalise whole-week achieved totals (not just this-run blocks):
        // prepared.effectiveMinutes is the remaining deficit after log credit.
        // Spend from-now budget to pull deficits toward a common residual level.
        const deficits = schedulable.map((p) => p.effectiveMinutes).sort((a, b) => a - b);
        let residual = deficits[deficits.length - 1] ?? 0;
        for (let i = 0; i < deficits.length; i++) {
          const nextResidual = i === deficits.length - 1 ? 0 : deficits[i]!;
          const step = residual - nextResidual;
          const active = deficits.length - i;
          const cost = step * active;
          if (budget >= cost) {
            residual = nextResidual;
            continue;
          }
          residual = residual - budget / active;
          break;
        }
        const quantisedResidual = Math.max(0, Math.floor(residual / QUANTUM) * QUANTUM);
        for (const p of schedulable) {
          const capped = Math.max(0, p.effectiveMinutes - quantisedResidual);
          p.effectiveMinutes = Math.min(p.effectiveMinutes, capped);
        }
        let assigned = schedulable.reduce((acc, p) => acc + p.effectiveMinutes, 0);
        let remaining = budget - assigned;
        while (remaining >= QUANTUM) {
          const eligible = schedulable
            .map((p) => ({
              p,
              residual: (originalDemand.get(p) ?? 0) - p.effectiveMinutes
            }))
            .filter((x) => x.residual >= QUANTUM)
            .sort((a, b) => b.residual - a.residual);
          if (eligible.length === 0) break;
          let gaveAny = false;
          for (const x of eligible) {
            if (remaining < QUANTUM) break;
            x.p.effectiveMinutes += QUANTUM;
            remaining -= QUANTUM;
            gaveAny = true;
          }
          if (!gaveAny) break;
          assigned = schedulable.reduce((acc, p) => acc + p.effectiveMinutes, 0);
          remaining = budget - assigned;
        }
      } else {
        const budget = weekCapacityFromNowMinutes;
        const weights = schedulable.map((p) => p.effectiveMinutes);
        const alloc = proportionalMinutesOnGrid(weights, budget);
        for (let i = 0; i < schedulable.length; i++) {
          schedulable[i]!.effectiveMinutes = alloc[i] ?? 0;
        }
      }
    }
  }

  /** Free gaps after segments, before goals — used to even out inter-goal slack in "even" mode. */
  const gapsBeforeGoals = days.map((d) => d.gaps.map((g) => ({ ...g })));

  // Pass 3 — placement: schedule each prepared goal, day by day, honouring
  // per-day caps. Order matters when free time is scarce, so we sort:
  //   1. commitment tier (non-negotiable → committed → nice-to-have),
  //   2. explicit weekly-floor goals first (`weeklyFloorBeforeCatchUpBump`, so
  //      catch-up-only bumps do not reorder ahead of true equal-share peers),
  //   3. gym goals next (they consume drive pads — must run before fillers),
  //   4. then by user-provided list order,
  //   5. then by remaining minutes desc as a final tie-breaker.
  prepared.sort((a, b) => comparePreparedGoalsForPass3Placement(a, b, fw));

  const placementDemandBeforePass3 = new Map(
    prepared.map((p) => [p.goal.id, p.effectiveMinutes] as const)
  );

  const pass3Sequential = prepared.filter(
    (p) => p.goal.specialGoalType === "gym" || p.weeklyFloorBeforeCatchUpBump > 0
  );
  const pass3RoundRobin = prepared.filter(
    (p) => p.goal.specialGoalType !== "gym" && p.weeklyFloorBeforeCatchUpBump <= 0
  );

  const runAllocateGoalPass3 = (p: PreparedGoal) => {
    if (p.effectiveMinutes <= 0) return;
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
      sleepIntervals,
      batteryContext,
      groupPlacement
    );
  };

  for (const p of pass3Sequential) runAllocateGoalPass3(p);

  const goalClaimsPctShare = (p: PreparedGoal) =>
    p.goal.allocationSharePercent != null && p.goal.allocationSharePercent > 0;

  /** When remaining demands fall in the same quantum bucket, prefer tighter daily caps first. */
  const ascendingDailyCapTie = (a: PreparedGoal, b: PreparedGoal): number => {
    const ca = a.norm.maxMinutesPerDay ?? Number.MAX_SAFE_INTEGER;
    const cb = b.norm.maxMinutesPerDay ?? Number.MAX_SAFE_INTEGER;
    if (ca !== cb) return ca - cb;
    return 0;
  };

  // Round-robin waves: %-share goals sorted descending (large targets first within
  // that cohort) interleaved with equal-share goals sorted ascending. Pure pct-first
  // fragments the grid before modest peers run (equal-share starvation); pure ascending
  // leaves %-rows too late. Interleaving gives both cohorts an early pick each wave.
  // Within a quantum-wide demand tie, tighter maxMinutesPerDay runs first — capped
  // peers need more distinct pocket shapes than unconstrained rows at the same target.
  const RR_ROUNDS = 128;
  for (let r = 0; r < RR_ROUNDS; r++) {
    let progressed = false;
    const pct = pass3RoundRobin.filter(goalClaimsPctShare).sort((a, b) => {
      const da = a.effectiveMinutes;
      const db = b.effectiveMinutes;
      if (Math.abs(da - db) < QUANTUM) {
        const cap = ascendingDailyCapTie(a, b);
        if (cap !== 0) return cap;
        return r % 2 === 0 ? a.index - b.index : b.index - a.index;
      }
      return db - da;
    });
    const free = pass3RoundRobin.filter((p) => !goalClaimsPctShare(p)).sort((a, b) => {
      const da = a.effectiveMinutes;
      const db = b.effectiveMinutes;
      if (Math.abs(da - db) < QUANTUM) {
        const cap = ascendingDailyCapTie(a, b);
        if (cap !== 0) return cap;
        return r % 2 === 0 ? a.index - b.index : b.index - a.index;
      }
      return da - db;
    });
    const seq: PreparedGoal[] = [];
    for (let i = 0, j = 0; i < pct.length || j < free.length; ) {
      if (i < pct.length) {
        seq.push(pct[i]!);
        i++;
      }
      if (j < free.length) {
        seq.push(free[j]!);
        j++;
      }
    }
    for (const p of seq) {
      if (p.effectiveMinutes < QUANTUM) continue;
      const before = p.effectiveMinutes;
      runAllocateGoalPass3(p);
      if (p.effectiveMinutes < before) progressed = true;
    }
    if (!progressed) break;
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

  const metrics = computeMetrics(
    plan,
    prepared,
    blocks,
    days,
    settings,
    allocationNowMs,
    busy,
    weekStartMs,
    weekEndMs,
    goalOverrides,
    goalOverrideSources,
    weekCapacityMinutes,
    weekCapacityFromNowMinutes,
    {
      grossWeekMinutes,
      busyWeekMinutes,
      consistencyReservedWeekMinutes,
      busyTrueEventCount
    },
    goalGroupWeeklyGapsPre,
    placementDemandBeforePass3
  );
  if (overcommitted) metrics.overcommitted = overcommitted;
  metrics.notScheduled = notScheduled;
  if (batteryOn && dayDrainScores) {
    metrics.personalEnergyPlan = {
      dayCalendarDrain: [...dayDrainScores],
      tuningHints: buildPersonalEnergyTuningHints(plan, dayDrainScores)
    };
  }

  return { blocks, metrics };
}

/**
 * Pass 1 + Pass 2: derive each goal's `effectiveMinutes` for the week.
 *
 *   - Pass 1 reserves every goal's `minMinutesPerWeek` as a floor.
 *   - Pass 2 distributes the remaining free time after floors: `%` goals target
 *     `(pct/100) * T` where `T` is full-week schedulable gap time (`totalFreeMin`);
 *     the cohort never receives more than remainder `R` after Pass 1. Goals with
 *     no `%` split whatever is left after those targets (or share `R` evenly when
 *     there are no `%` rows). Goals with a positive **user** weekly floor (before any
 *     catch-up bump) do not participate unless they set `allocationSharePercent`
 *     (so "min" behaves as a floor). Catch-up-inflated floors alone still join Pass 2.
 *     Calendar layout then uses `allocator.allocationMode`
 *     only: `"even"` spreads slack inside each free window as gaps between goal
 *     runs; `"finish-early"` leaves blocks packed without that padding so
 *     leftover time stays toward the end of the window.
 *
 *   - When floors exceed `totalFreeMin`, we either scale floors proportionally
 *     (default) or pay them in user order until time runs out (strict).
 */

/**
 * Pass-2 minute targets from `% of full-week schedulable time` `T` (same as
 * `weekCapacityMinutes` / `totalFreeMin`), capped so the cohort never receives
 * more than post-floor remainder `R`.
 *
 * - Rows with `allocationSharePercent` want `(pct/100) * T` each.
 * - Rows without `%` share any leftover `R - sum(rawPctWants)` evenly.
 * - If only `%` rows and their raw wants exceed `R`, scale those wants down
 *   proportionally.
 * - If only equal-share rows (no `%`), split `R` evenly.
 */
export function computePass2AllocMinutesFromShareOfWeek(
  goals: readonly WeeklyGoal[],
  weekCapacityMinutes: number,
  remainderMinutes: number
): number[] {
  const n = goals.length;
  if (n === 0 || remainderMinutes <= 0) return [];
  const T = Math.max(0, weekCapacityMinutes);
  const R = remainderMinutes;

  const pctIdx: number[] = [];
  const eqIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (goals[i]!.allocationSharePercent !== undefined) pctIdx.push(i);
    else eqIdx.push(i);
  }

  const rawP = Array<number>(n).fill(0);
  for (const i of pctIdx) {
    const p = goals[i]!.allocationSharePercent!;
    const c = Math.min(100, Math.max(0, p));
    rawP[i] = (c / 100) * T;
  }
  const sumP = pctIdx.reduce((a, i) => a + rawP[i]!, 0);

  const out = Array<number>(n).fill(0);

  if (pctIdx.length === 0) {
    const per = R / n;
    for (let i = 0; i < n; i++) out[i] = per;
    return out;
  }

  if (eqIdx.length > 0) {
    if (sumP >= R) {
      const scale = R / Math.max(sumP, 1e-9);
      for (const i of pctIdx) out[i] = rawP[i]! * scale;
    } else {
      for (const i of pctIdx) out[i] = rawP[i]!;
      const rest = R - sumP;
      const per = rest / eqIdx.length;
      for (const i of eqIdx) out[i] = per;
    }
    return out;
  }

  // %-only cohort
  if (sumP <= 1e-9) {
    const per = R / n;
    for (let i = 0; i < n; i++) out[i] = per;
    return out;
  }
  if (sumP <= R) {
    for (const i of pctIdx) out[i] = rawP[i]!;
    return out;
  }
  const scale = R / sumP;
  for (const i of pctIdx) out[i] = rawP[i]! * scale;
  return out;
}

/**
 * Fraction of the current post-floor remainder each goal takes in Pass 2
 * (`alloc_i / remainder`), using `% of full-week time T` (see
 * `computePass2AllocMinutesFromShareOfWeek`).
 */
export function computeAllocationRemainderFractions(
  goals: readonly WeeklyGoal[],
  weekCapacityMinutes: number,
  remainderMinutes: number
): number[] {
  const alloc = computePass2AllocMinutesFromShareOfWeek(goals, weekCapacityMinutes, remainderMinutes);
  const r = Math.max(0, remainderMinutes);
  if (r <= 1e-9) return goals.map(() => 0);
  return alloc.map((m) => m / r);
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
    const weeklyFloorBeforeCatchUpBump = norm.minMinutesPerWeek ?? 0;
    const bump = catchUpFloors?.[goal.id] ?? 0;
    if (bump !== 0) {
      // Floor only. Raising the weekly ceiling here made allocations exceed a
      // stated `maxMinutesPerWeek` (catch-up looked like "ignore my cap").
      norm.minMinutesPerWeek = Math.max(0, weeklyFloorBeforeCatchUpBump + bump);
    }
    return {
      goal,
      norm,
      weeklyFloorBeforeCatchUpBump,
      plannedWeeklyMinutes: 0,
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
      const weights = prepared.map((p) => p.effectiveMinutes);
      const alloc = proportionalMinutesOnGrid(weights, totalFreeMin);
      for (let i = 0; i < prepared.length; i++) {
        prepared[i]!.effectiveMinutes = alloc[i] ?? 0;
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
    for (const p of prepared) {
      p.plannedWeeklyMinutes = p.effectiveMinutes;
    }
    return { prepared, overcommitted, notScheduled };
  }

  let remainder = totalFreeMin - floorTotal;
  const remainderPass2Start = remainder;

  // Pass 2: `%` rows target (pct/100)*T of full-week schedulable time T; the pool
  // for this pass is remainder R after floors. See `computePass2AllocMinutesFromShareOfWeek`.
  //
  // Fractions / caps MUST use the same cohort as `eligible()` below.

  const eligible = () =>
    prepared.filter((p) => {
      const cap = p.norm.maxMinutesPerWeek;
      if (cap !== undefined && p.effectiveMinutes >= cap) return false;
      // Ignore catch-up-inflated floors: only an explicit user weekly floor (or
      // derived weekly min before catch-up) opts out of Pass 2 remainder sharing.
      if (
        p.weeklyFloorBeforeCatchUpBump > 0 &&
        p.goal.allocationSharePercent === undefined
      ) {
        return false;
      }
      return true;
    });

  const baseEffectiveByIndex = new Map(prepared.map((p) => [p.index, p.effectiveMinutes] as const));
  const T = totalFreeMin;
  const seedPrepared = eligible();
  const maxRemainderSliceByIndex = new Map<number, number>();
  for (const p of seedPrepared) {
    const pct = p.goal.allocationSharePercent;
    const slice =
      pct !== undefined
        ? quantise(Math.min(remainderPass2Start, (Math.min(100, Math.max(0, pct)) / 100) * T))
        : remainderPass2Start;
    maxRemainderSliceByIndex.set(p.index, slice);
  }

  let rounds = prepared.length + 1;
  while (remainder >= QUANTUM && rounds-- > 0) {
    const set = eligible();
    if (set.length === 0) break;
    const goalsInSet = set.map((x) => x.goal);
    const floatMins = computePass2AllocMinutesFromShareOfWeek(goalsInSet, T, remainder);
    let weights = floatMins.map((m) => Math.max(0, m));
    if (weights.every((w) => w <= 0)) {
      weights = Array<number>(set.length).fill(1);
    }
    const alloc = proportionalMinutesOnGrid(weights, remainder);
    let consumed = 0;
    for (let i = 0; i < set.length; i++) {
      const p = set[i]!;
      const share = alloc[i] ?? 0;
      if (share <= 0) continue;
      const cap = p.norm.maxMinutesPerWeek;
      const headroom =
        cap === undefined ? share : Math.max(0, cap - p.effectiveMinutes);
      const fromPass2 = p.effectiveMinutes - (baseEffectiveByIndex.get(p.index) ?? 0);
      const sliceCap = maxRemainderSliceByIndex.get(p.index);
      const sliceLeft =
        sliceCap === undefined ? Number.POSITIVE_INFINITY : Math.max(0, sliceCap - fromPass2);
      const give = Math.min(share, headroom, remainder - consumed, sliceLeft);
      if (give <= 0) continue;
      p.effectiveMinutes += give;
      consumed += give;
    }
    if (consumed === 0) break;
    remainder -= consumed;
  }

  for (const p of prepared) {
    p.plannedWeeklyMinutes = p.effectiveMinutes;
  }

  return { prepared, overcommitted, notScheduled };
}

function quantise(min: number): number {
  return Math.max(0, Math.round(min / QUANTUM) * QUANTUM);
}

/**
 * Split `totalBudget` minutes across goals in proportion to `weights` (floors),
 * on the 15-minute grid, using largest-remainder so the parts sum to
 * `floor(totalBudget / 15) * 15` (avoids independent round-off blowing the budget).
 */
function proportionalMinutesOnGrid(weights: readonly number[], totalBudget: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) return Array<number>(n).fill(0);
  const totalQuanta = Math.floor(Math.max(0, totalBudget) / QUANTUM);
  if (totalQuanta <= 0) return Array<number>(n).fill(0);

  const exact = weights.map((w) => (w / sumW) * totalQuanta);
  const down = exact.map((e) => Math.floor(e));
  let usedQ = down.reduce((a, b) => a + b, 0);
  let remQ = totalQuanta - usedQ;
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) }));
  order.sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.i - b.i));
  for (let j = 0; j < remQ; j++) {
    const idx = order[j % order.length]!.i;
    down[idx] = (down[idx] ?? 0) + 1;
  }
  return down.map((q) => q * QUANTUM);
}

/** Drag key format: `goal:<YYYY-MM-DD>:<slot>:<goalId>`. */
function goalIdFromGoalDragKey(key: string): string | undefined {
  const m = /^goal:[\d-]+:\d+:(.+)$/.exec(key);
  return m?.[1];
}

function goalWeeklyCeilingMinutesFromGroup(group: GoalGroup, T: number): number | undefined {
  const stub = stubWeeklyGoalFromGoalGroup(group);
  const norm = normaliseGoalTime(stub);
  let cap: number | undefined;
  if (stub.allocationSharePercent !== undefined) {
    const p = Math.min(100, Math.max(1, stub.allocationSharePercent));
    cap = (p / 100) * T;
  }
  if (norm.maxMinutesPerWeek !== undefined) {
    cap = cap === undefined ? norm.maxMinutesPerWeek : Math.min(cap, norm.maxMinutesPerWeek);
  }
  return cap === undefined ? undefined : quantise(cap);
}

function applyGoalGroupWeeklyCaps(
  prepared: PreparedGoal[],
  plan: WeeklyPlan,
  weekCapacityMinutes: number,
  gapsOut: Array<{
    groupId: string;
    reason: "weeklyCap" | "weeklyFloor";
    shortMinutes: number;
  }>
): void {
  const groups = plan.goalGroups ?? [];
  if (groups.length === 0) return;

  const validGroupIds = new Set(groups.map((g) => g.id));
  const goalToGroups = new Map<string, string[]>();
  for (const g of plan.goals) {
    const ids = g.groupIds?.filter((id) => validGroupIds.has(id));
    if (ids?.length) goalToGroups.set(g.id, ids);
  }

  const sortedGroups = [...groups].sort((a, b) => a.id.localeCompare(b.id));

  for (let round = 0; round < sortedGroups.length + 12; round++) {
    let changed = false;
    for (const grp of sortedGroups) {
      const members = prepared.filter((p) => goalToGroups.get(p.goal.id)?.includes(grp.id));
      if (members.length === 0) continue;

      const ceiling = goalWeeklyCeilingMinutesFromGroup(grp, weekCapacityMinutes);
      const sum = members.reduce((acc, p) => acc + p.plannedWeeklyMinutes, 0);

      if (ceiling !== undefined && sum > ceiling) {
        const over = sum - ceiling;
        const slackWeights = members.map((p) =>
          Math.max(0, p.plannedWeeklyMinutes - (p.norm.minMinutesPerWeek ?? 0))
        );
        const totalSlack = slackWeights.reduce((a, b) => a + b, 0);
        if (totalSlack < QUANTUM) {
          gapsOut.push({
            groupId: grp.id,
            reason: "weeklyCap",
            shortMinutes: Math.max(0, sum - ceiling)
          });
          continue;
        }
        const budget = quantise(Math.min(over, totalSlack));
        const cuts = proportionalMinutesOnGrid(slackWeights, budget);
        for (let i = 0; i < members.length; i++) {
          const cut = cuts[i] ?? 0;
          if (cut <= 0) continue;
          const p = members[i]!;
          const maxCut = Math.max(0, p.plannedWeeklyMinutes - (p.norm.minMinutesPerWeek ?? 0));
          const actual = Math.min(cut, maxCut);
          if (actual <= 0) continue;
          p.plannedWeeklyMinutes -= actual;
          p.effectiveMinutes -= actual;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  for (const grp of sortedGroups) {
    const members = prepared.filter((p) => goalToGroups.get(p.goal.id)?.includes(grp.id));
    if (members.length === 0) continue;
    const stub = stubWeeklyGoalFromGoalGroup(grp);
    const norm = normaliseGoalTime(stub);
    const floorMin = norm.minMinutesPerWeek;
    if (floorMin === undefined || floorMin <= 0) continue;
    const sum = members.reduce((acc, p) => acc + p.plannedWeeklyMinutes, 0);
    if (sum + 1e-6 < floorMin) {
      gapsOut.push({
        groupId: grp.id,
        reason: "weeklyFloor",
        shortMinutes: Math.max(0, floorMin - sum)
      });
    }
  }
}

interface GoalGroupPlacementContext {
  goalToGroups: ReadonlyMap<string, readonly string[]>;
  maxMinutesPerDayByGroup: ReadonlyMap<string, number>;
  usedMinutesByGroupDay: Map<string, number[]>;
}

function addIntervalOverlapMinutesByDay(
  startMs: number,
  endMs: number,
  days: readonly { startMs: number; endMs: number }[],
  add: (dayIdx: number, minutes: number) => void
): void {
  for (let d = 0; d < days.length; d++) {
    const day = days[d]!;
    const s = Math.max(startMs, day.startMs);
    const e = Math.min(endMs, day.endMs);
    if (e > s) add(d, Math.floor((e - s) / MS_PER_MIN));
  }
}

function intervalMinutesFull(interval: Interval): number {
  if (interval.endMs <= interval.startMs) return 0;
  return Math.floor((interval.endMs - interval.startMs) / MS_PER_MIN);
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
    // We use explicit weekly min (else max) — `targetMinutes` alone does not
    // count here; wheel top-ups reflect uncovered floors vs real min/max.
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
  sleepIntervals: readonly Interval[] | undefined,
  battery?: {
    goalsById: ReadonlyMap<string, WeeklyGoal>;
    dayDrainScores: number[];
    personalSystem: PersonalSystem;
  },
  groupPlacement?: GoalGroupPlacementContext
): void {
  const { goal, norm } = prepared;
  let remainingMinutes = prepared.effectiveMinutes;
  try {
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
  let perDayBudget = Math.max(perDay, minPerDay);

  const dayHeadroomFor = (dayIdx: number): number => {
    const day = days[dayIdx]!;
    const dayMinutesAlready = blocks
      .filter((b) => b.goalId === goal.id && b.startMs >= day.startMs && b.endMs <= day.endMs)
      .reduce((acc, b) => acc + Math.floor((b.endMs - b.startMs) / MS_PER_MIN), 0);
    const dayLoggedMinutes = loggedGoalBusyMinutesForDay(busy, goal.id, day.startMs, day.endMs);
    return norm.maxMinutesPerDay !== undefined
      ? Math.max(0, norm.maxMinutesPerDay - (dayMinutesAlready + dayLoggedMinutes))
      : Number.POSITIVE_INFINITY;
  };

  const effectiveDayHeadroomFor = (dayIdx: number): number =>
    Math.min(dayHeadroomFor(dayIdx), aggregateGroupDailyHeadroomMinutes(groupPlacement, goal.id, dayIdx));

  const hasFuturePlacementWindow = (dayIdx: number): boolean => {
    const day = days[dayIdx]!;
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
    return futureCandidateGaps.length > 0;
  };

  const occupiedGoalDayIndexes = (): Set<number> => {
    const out = new Set<number>();
    for (const b of blocks) {
      if (b.goalId !== goal.id) continue;
      const idx = dayIndexForMsInWeek(b.startMs, weekStartMs, tz);
      if (idx >= 0) out.add(idx);
    }
    return out;
  };

  const hasAdjacentGoalDay = (dayIdx: number, occupied: ReadonlySet<number>): boolean =>
    occupied.has(dayIdx - 1) || occupied.has(dayIdx + 1);

  const hasNonAdjacentAlternativeDay = (
    currentDayIdx: number,
    occupied: ReadonlySet<number>
  ): boolean => {
    for (const altDayIdx of allowedDays) {
      if (altDayIdx === currentDayIdx) continue;
      if (occupied.has(altDayIdx)) continue;
      if (hasAdjacentGoalDay(altDayIdx, occupied)) continue;
      if (effectiveDayHeadroomFor(altDayIdx) < QUANTUM) continue;
      if (!hasFuturePlacementWindow(altDayIdx)) continue;
      return true;
    }
    return false;
  };

  // Re-size daily budget to the number of days that are actually schedulable
  // in this run horizon (future windows + day headroom). This preserves the
  // one-block-per-day rule while avoiding undersized blocks mid-week.
  if (norm.frequencyPerWeek === undefined) {
    const schedulableAllowedDays = allowedDays.filter(
      (dayIdx) => effectiveDayHeadroomFor(dayIdx) >= QUANTUM && hasFuturePlacementWindow(dayIdx)
    );
    const schedulableCount = schedulableAllowedDays.length;
    if (schedulableCount > 0 && schedulableCount < targetDays) {
      perDay = Math.ceil(remainingMinutes / schedulableCount);
      if (norm.maxMinutesPerDay !== undefined) {
        perDay = Math.min(perDay, norm.maxMinutesPerDay);
      }
      if (perDay <= 0) return;
      perDayBudget = Math.max(perDay, minPerDay);
    }
  }

  let slotIndex = nextAutoGoalSlotIndex(blocks, goal.id, weekAnchorDate);
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
  // Each pass schedules at most one auto block per allowed day. Fragmented weeks
  // (many small pockets on the same day, or invert / nice-weather windows) may need
  // far more passes than a tiny fixed cap — otherwise we stop at `maxPasses` with
  // demand left though gaps still exist. Scale with quantised demand × allowed
  // days (conservative); cap as a safety rail. Idle passes still exit early via
  // `daysScheduledThisPass === 0`.
  const baselineMaxPasses = needsExtraPasses ? 64 : 48;
  const demandPasses =
    Math.ceil(remainingMinutes / QUANTUM) * Math.max(1, allowedDays.length);
  const maxPasses = Math.min(2048, Math.max(baselineMaxPasses, demandPasses));
  for (let pass = 0; pass < maxPasses && remainingMinutes > 0; pass++) {
    let daysScheduledThisPass = 0;
    for (const dayIdx of allowedDays) {
      if (remainingMinutes <= 0) break;
      if (norm.frequencyPerWeek !== undefined && pass === 0 && daysScheduledThisPass >= targetDays)
        break;
      const day = days[dayIdx]!;
      const dayGoalBlocks = blocks.filter(
        (b) => b.goalId === goal.id && b.startMs >= day.startMs && b.endMs <= day.endMs
      );
      const dayMinutesAlready = dayGoalBlocks.reduce(
        (acc, b) => acc + Math.floor((b.endMs - b.startMs) / MS_PER_MIN),
        0
      );
      const dayLoggedMinutes = loggedGoalBusyMinutesForDay(busy, goal.id, day.startMs, day.endMs);
      let dayHeadroom =
        norm.maxMinutesPerDay !== undefined
          ? Math.max(0, norm.maxMinutesPerDay - (dayMinutesAlready + dayLoggedMinutes))
          : Number.POSITIVE_INFINITY;
      dayHeadroom = Math.min(dayHeadroom, aggregateGroupDailyHeadroomMinutes(groupPlacement, goal.id, dayIdx));
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
            recordGoalGroupPlacementMinutes(groupPlacement, goal.id, dayIdx, pinMinutes);
            slotIndex++;
            daysScheduledThisPass++;
            continue;
          }
          ignoredGoalPinKeys.add(dragKey);
        } else if (ovDay < 0) {
          ignoredGoalPinKeys.add(dragKey);
        }
      }

      // Pass 0 establishes an even per-day budget; pass 1+ spill `remainingMinutes`
      // into any day that still has gap + headroom. Skipping days that already have a block prevented spill entirely (large hatched “available” bands
      // stayed empty while weekly targets stayed unfilled).
      if (dayGoalBlocks.length > 0 && remainingMinutes < QUANTUM) continue;

      // Secondary guardrail (even-split pass only): avoid placing this goal on
      // consecutive days when a non-adjacent day is still available. Skip this when
      // the goal already uses invert / nice-weather windows — pockets are scarce and
      // pass-0 deferral leaves demand unplaced while peers fill shared gaps.
      const occupiedDays = occupiedGoalDayIndexes();
      if (
        pass === 0 &&
        !needsExtraPasses &&
        hasAdjacentGoalDay(dayIdx, occupiedDays) &&
        hasNonAdjacentAlternativeDay(dayIdx, occupiedDays)
      ) {
        continue;
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
        gymTravelPadMin,
        battery
          ? {
              goalsById: battery.goalsById,
              dayDrainScores: battery.dayDrainScores,
              dayIdx,
              personalSystem: battery.personalSystem
            }
          : undefined
      );
      if (!slot) continue;
      // Pass 0 caps each placement at `perDayBudget` for an even spread. Spill passes
      // must use `remainingMinutes` — otherwise `maxMinutesPerDay` / `frequencyPerWeek`
      // kept `preferEvenSplitThisPass` true forever and every round reused `perDayBudget`,
      // so blocks grew one thin slice at a time (or left huge gaps when passes ran out).
      const preferEvenSplitThisPass = pass === 0;
      const targetThisDay = preferEvenSplitThisPass ? perDayBudget : remainingMinutes;
      const wantThisDay = Math.min(remainingMinutes, targetThisDay, dayHeadroom);
      const usedMinutes = Math.min(wantThisDay, slot.minutes);
      if (usedMinutes < QUANTUM) continue;
      // Honour minMinutesPerDay: bump up to the daily floor when the gap allows
      // (the old branch computed `bigger` but never applied it, leaving thin slices).
      let placeMinutes = usedMinutes;
      if (minPerDay > 0 && usedMinutes < minPerDay && slot.minutes >= minPerDay) {
        const bigger = Math.min(remainingMinutes, dayHeadroom, slot.minutes);
        if (bigger < minPerDay) continue;
        placeMinutes = Math.min(bigger, Math.max(usedMinutes, minPerDay));
      }
      const ms = placeMinutes * MS_PER_MIN;
      const { startMs, endMs } = placeBlockInGap(slot.gap, ms, goal, tz, gymTravelPadMs);
      const placedMinutes = Math.floor((endMs - startMs) / MS_PER_MIN);
      if (placedMinutes < QUANTUM) continue;
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
      remainingMinutes -= placedMinutes;
      recordGoalGroupPlacementMinutes(groupPlacement, goal.id, dayIdx, placedMinutes);
      slotIndex++;
      daysScheduledThisPass++;
    }
    if (daysScheduledThisPass === 0) break;
  }
  const nodeEnv =
    (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV ?? "";
  if (
    nodeEnv !== "production" &&
    remainingMinutes >= QUANTUM &&
    needsExtraPasses &&
    remainingMinutes <= 8 * 60
  ) {
    console.warn(
      `[allocateWeek] Goal "${goal.title}" (${goal.id}) has ${remainingMinutes} min unscheduled after ${maxPasses} passes (availability/nice-weather squeeze).`
    );
  }
  } finally {
    prepared.effectiveMinutes = Math.max(0, remainingMinutes);
  }
}

function pinnedActualGoalOverrideMinutesForWindow(
  goalId: string,
  windowStartMs: number,
  windowEndMs: number,
  goalOverrides: ReadonlyMap<string, { startMs: number; endMs: number }>,
  goalOverrideSources: ReadonlyMap<string, "drag" | "actual">
): number {
  let total = 0;
  const keySuffix = `:${goalId}`;
  for (const [key, override] of goalOverrides) {
    if (!key.endsWith(keySuffix)) continue;
    if (goalOverrideSources.get(key) !== "actual") continue;
    const startMs = Math.max(override.startMs, windowStartMs);
    const endMs = Math.min(override.endMs, windowEndMs);
    if (endMs <= startMs) continue;
    total += Math.floor((endMs - startMs) / MS_PER_MIN);
  }
  return total;
}

function loggedGoalBusyMinutesForWindow(
  busy: readonly BusyEvent[],
  goalId: string,
  windowStartMs: number,
  windowEndMs: number
): number {
  const prefix = `daysheet-goal:${goalId}:`;
  let total = 0;
  for (const ev of busy) {
    if (!ev.sourceId?.startsWith(prefix)) continue;
    const startMs = Math.max(ev.startMs, windowStartMs);
    const endMs = Math.min(ev.endMs, windowEndMs);
    if (endMs <= startMs) continue;
    total += Math.floor((endMs - startMs) / MS_PER_MIN);
  }
  return total;
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

function initGoalGroupPlacementContext(
  plan: WeeklyPlan,
  busy: readonly BusyEvent[],
  goalOverrides: ReadonlyMap<string, { startMs: number; endMs: number }>,
  days: readonly { startMs: number; endMs: number }[]
): GoalGroupPlacementContext | undefined {
  const groups = plan.goalGroups ?? [];
  if (groups.length === 0) return undefined;

  const validGroupIds = new Set(groups.map((g) => g.id));
  const goalToGroups = new Map<string, string[]>();
  for (const g of plan.goals) {
    const ids = g.groupIds?.filter((id) => validGroupIds.has(id));
    if (ids?.length) goalToGroups.set(g.id, ids);
  }

  const maxMinutesPerDayByGroup = new Map<string, number>();
  const membersByGroup = new Map<string, Set<string>>();
  for (const grp of groups) {
    const norm = normaliseGoalTime(stubWeeklyGoalFromGoalGroup(grp));
    if (norm.maxMinutesPerDay === undefined) continue;
    maxMinutesPerDayByGroup.set(grp.id, norm.maxMinutesPerDay);
    const mem = new Set<string>();
    for (const g of plan.goals) {
      if (g.groupIds?.includes(grp.id)) mem.add(g.id);
    }
    membersByGroup.set(grp.id, mem);
  }

  if (maxMinutesPerDayByGroup.size === 0) return undefined;

  const usedMinutesByGroupDay = new Map<string, number[]>();
  for (const [gid, members] of membersByGroup) {
    if (!maxMinutesPerDayByGroup.has(gid)) continue;
    const used = [0, 0, 0, 0, 0, 0, 0];
    for (const goalId of members) {
      for (let d = 0; d < 7; d++) {
        const day = days[d]!;
        used[d] = (used[d] ?? 0) + loggedGoalBusyMinutesForDay(busy, goalId, day.startMs, day.endMs);
      }
    }
    for (const [key, ov] of goalOverrides) {
      const goalId = goalIdFromGoalDragKey(key);
      if (!goalId || !members.has(goalId)) continue;
      addIntervalOverlapMinutesByDay(ov.startMs, ov.endMs, days, (d, mins) => {
        used[d] = (used[d] ?? 0) + mins;
      });
    }
    usedMinutesByGroupDay.set(gid, used);
  }

  return {
    goalToGroups,
    maxMinutesPerDayByGroup,
    usedMinutesByGroupDay
  };
}

function recordGoalGroupPlacementMinutes(
  ctx: GoalGroupPlacementContext | undefined,
  goalId: string,
  dayIdx: number,
  minutes: number
): void {
  if (!ctx || minutes <= 0 || dayIdx < 0 || dayIdx > 6) return;
  const gids = ctx.goalToGroups.get(goalId);
  if (!gids?.length) return;
  for (const gid of gids) {
    if (!ctx.maxMinutesPerDayByGroup.has(gid)) continue;
    const row = ctx.usedMinutesByGroupDay.get(gid);
    if (!row) continue;
    row[dayIdx] = (row[dayIdx] ?? 0) + minutes;
  }
}

function aggregateGroupDailyHeadroomMinutes(
  ctx: GoalGroupPlacementContext | undefined,
  goalId: string,
  dayIdx: number
): number {
  if (!ctx) return Number.POSITIVE_INFINITY;
  const gids = ctx.goalToGroups.get(goalId);
  if (!gids?.length) return Number.POSITIVE_INFINITY;
  let hr = Number.POSITIVE_INFINITY;
  for (const gid of gids) {
    const cap = ctx.maxMinutesPerDayByGroup.get(gid);
    if (cap === undefined) continue;
    const used = ctx.usedMinutesByGroupDay.get(gid)?.[dayIdx] ?? 0;
    hr = Math.min(hr, Math.max(0, cap - used));
  }
  return hr;
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

const BATTERY_PLACEMENT_WEIGHTS = {
  drainDrainPenalty: 3,
  chargeAfterDrainBonus: 2,
  calendarRecoveryBonus: 2,
  ruleBonus: 1.5
} as const;

function buildPersonalEnergyTuningHints(plan: WeeklyPlan, dayDrain: number[]): string[] {
  const hints: string[] = [];
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  dayDrain.forEach((d, i) => {
    if (d >= 0.72) {
      const label = labels[i] ?? `Day ${i + 1}`;
      hints.push(
        `${label} looks calendar-heavy (~${Math.round(d * 100)}% vs reference day) — favour deep-focus or recovery blocks after heavy external time.`
      );
    }
  });
  const sched = filterSchedulingGoals(plan.goals);
  const untagged = sched.filter(
    (g) =>
      g.energyChargeImpact === undefined &&
      g.energyDrainImpact === undefined &&
      g.focusAffinity === undefined &&
      g.attentionMode === "unspecified"
  );
  if (untagged.length >= 3) {
    hints.push(
      `${untagged.length} goals still use default energy tags — set charge/drain or focus affinity on key goals for a tighter personal fit.`
    );
  }
  return hints.slice(0, 6);
}

function scoreBatteryPlacement(
  gap: Interval,
  goal: WeeklyGoal,
  tz: string,
  placedToday: readonly AllocatedBlock[],
  battery: {
    goalsById: ReadonlyMap<string, WeeklyGoal>;
    dayDrainScores: readonly number[];
    dayIdx: number;
    personalSystem: PersonalSystem;
  }
): number {
  const profile = effectiveEnergyBatteryProfile(goal);
  const scale = battery.personalSystem.guided.drainTransitionPenaltyScale;
  const calBias = battery.personalSystem.guided.calendarDrainRecoveryBias;
  let score = 0;

  const dayDrain = battery.dayDrainScores[battery.dayIdx] ?? 0;
  if (calBias > 0 && dayDrain >= 0.55 && profile.charge >= 0.5) {
    score += BATTERY_PLACEMENT_WEIGHTS.calendarRecoveryBonus * calBias * (dayDrain - 0.5) * 2;
  }

  const windowMs = ENERGY_SUGGESTION_WEIGHTS.drainAdjacencyWindowMin * MS_PER_MIN;
  let adjacentDrain = false;
  let adjacentCharge = false;
  for (const placed of placedToday) {
    if (placed.segment) continue;
    const pg = battery.goalsById.get(placed.goalId);
    if (!pg) continue;
    const pp = effectiveEnergyBatteryProfile(pg);
    const closeBefore = gap.startMs - placed.endMs;
    const closeAfter = placed.startMs - gap.endMs;
    const isAdjacent =
      (closeBefore >= 0 && closeBefore <= windowMs) ||
      (closeAfter >= 0 && closeAfter <= windowMs);
    if (!isAdjacent) continue;
    if (pp.drain >= 0.5) adjacentDrain = true;
    if (pp.charge >= 0.5) adjacentCharge = true;
    if (profile.drain >= 0.5 && pp.drain >= 0.5) {
      score -= BATTERY_PLACEMENT_WEIGHTS.drainDrainPenalty * scale;
    }
    if (pp.drain >= 0.55 && profile.charge >= 0.55) {
      score += BATTERY_PLACEMENT_WEIGHTS.chargeAfterDrainBonus;
    }
  }

  for (const rule of battery.personalSystem.advancedRules) {
    if (!rule.enabled) continue;
    const ok =
      rule.condition === "always" ||
      (rule.condition === "after_drain_block" && adjacentDrain) ||
      (rule.condition === "after_focus_block" && adjacentCharge) ||
      (rule.condition === "morning_low_battery" &&
        (battery.dayDrainScores[battery.dayIdx] ?? 0) > 0.55 &&
        hourInTz(gap.startMs, tz) < 12);
    if (!ok) continue;
    const w = (rule.priority / 100) * BATTERY_PLACEMENT_WEIGHTS.ruleBonus;
    switch (rule.prefer) {
      case "avoid_back_to_back_drain":
        if (profile.drain >= 0.5 && adjacentDrain) score -= 2 * w;
        break;
      case "prefer_hyperfocus_goal":
        if (profile.charge >= 0.45 || goal.attentionMode === "hyperfocus") score += 2 * w;
        break;
      case "prefer_recovery_play":
        if (goal.workLayer === "play" || goal.specialGoalType === "morning-routine") score += 1.5 * w;
        break;
    }
  }

  return score;
}

function scoreGapForPlacementIdeals(
  gap: Interval,
  goal: WeeklyGoal,
  tz: string,
  blockMinutes: number
): number {
  const ideals = goal.placementIdealClockTimes;
  if (!ideals || ideals.length === 0 || blockMinutes <= 0) return 0;
  const blockMs = blockMinutes * MS_PER_MIN;
  const latestStart = gap.endMs - blockMs;
  if (latestStart < gap.startMs) return 0;

  const dk = dateKeyInTz(Math.floor((gap.startMs + gap.endMs) / 2), tz);
  const segs = dk.split("-");
  const ys = Number(segs[0]);
  const mo = Number(segs[1]);
  const da = Number(segs[2]);
  if (!Number.isFinite(ys) || !Number.isFinite(mo) || !Number.isFinite(da)) return 0;
  const dayMidnight = localMidnightMs(ys, mo, da, tz);

  let bestDistMin = Infinity;
  for (const t of ideals) {
    const idealMs = dayMidnight + (t.hour * 3600 + t.minute * 60) * 1000;
    const clampedStart = Math.max(gap.startMs, Math.min(idealMs, latestStart));
    const distMin = Math.abs(clampedStart - idealMs) / MS_PER_MIN;
    bestDistMin = Math.min(bestDistMin, distMin);
  }
  return -PLACEMENT_IDEAL_CLOCK_WEIGHT * bestDistMin;
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
  gymTravelPadMin = 0,
  battery?: {
    goalsById: ReadonlyMap<string, WeeklyGoal>;
    dayDrainScores: readonly number[];
    dayIdx: number;
    personalSystem: PersonalSystem;
  }
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
    const blockMin = Math.min(perDay, innerMin);
    const energyScore =
      weights.energyMode * scoreGapForEnergy(g, goal.energyMode, energy, tz);
    const suggestionScore =
      energy.mode === "ignore"
        ? 0
        : scoreEnergyAwareness(g, goal, tz, placedToday, weights, frameworkInclusion);
    const batteryScore = battery ? scoreBatteryPlacement(g, goal, tz, placedToday, battery) : 0;
    const idealScore = scoreGapForPlacementIdeals(g, goal, tz, blockMin);
    candidates.push({
      gap: g,
      minutes: blockMin,
      score: energyScore + suggestionScore + batteryScore + idealScore
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

/**
 * Stable Pass 3 ordering before greedy placement (exported for tests).
 * Uses `weeklyFloorBeforeCatchUpBump` so catch-up-inflated weekly mins do not
 * preempt true equal-share peers in list order.
 */
export function comparePreparedGoalsForPass3Placement(
  a: PreparedGoal,
  b: PreparedGoal,
  fw: SchedulerFrameworkInclusion
): number {
  if (fw.commitment) {
    const aTier = commitmentRank(a.goal.commitmentLevel);
    const bTier = commitmentRank(b.goal.commitmentLevel);
    if (aTier !== bTier) return aTier - bTier;
  }
  const aHasFloor = a.weeklyFloorBeforeCatchUpBump > 0 ? 0 : 1;
  const bHasFloor = b.weeklyFloorBeforeCatchUpBump > 0 ? 0 : 1;
  if (aHasFloor !== bHasFloor) return aHasFloor - bHasFloor;
  const aGym = a.goal.specialGoalType === "gym" ? 0 : 1;
  const bGym = b.goal.specialGoalType === "gym" ? 0 : 1;
  if (aGym !== bGym) return aGym - bGym;
  if (a.index !== b.index) return a.index - b.index;
  return b.effectiveMinutes - a.effectiveMinutes;
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
/** Weight for `placementIdealClockTimes`: gaps where the block can start nearer ideal score higher. */
const PLACEMENT_IDEAL_CLOCK_WEIGHT = 0.12;

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
  const innerLen = inner.endMs - inner.startMs;
  /** Never extend past the padded gap (rounding vs pickGapForGoal could let ms > innerLen). */
  const fitMs = Math.min(ms, innerLen);
  if (fitMs <= 0) {
    return { startMs: inner.startMs, endMs: inner.startMs };
  }
  const ideals = goal.placementIdealClockTimes;
  if (ideals && ideals.length > 0) {
    const dk = dateKeyInTz(Math.floor((inner.startMs + inner.endMs) / 2), tz);
    const segs = dk.split("-");
    const ys = Number(segs[0]);
    const mo = Number(segs[1]);
    const da = Number(segs[2]);
    if (!Number.isFinite(ys) || !Number.isFinite(mo) || !Number.isFinite(da)) {
      return { startMs: inner.startMs, endMs: inner.startMs + fitMs };
    }
    const dayMidnight = localMidnightMs(ys, mo, da, tz);
    let bestStart = inner.startMs;
    let bestDist = Infinity;
    for (const ideal of ideals) {
      const idealMs = dayMidnight + (ideal.hour * 3600 + ideal.minute * 60) * 1000;
      /** Align block start to ideal local clock (user-facing "ideal time"), not block midpoint. */
      const wantStart = idealMs;
      const clamped = Math.max(inner.startMs, Math.min(wantStart, inner.endMs - fitMs));
      const dist = Math.abs(clamped - idealMs);
      if (dist < bestDist) {
        bestDist = dist;
        bestStart = clamped;
      }
    }
    return { startMs: bestStart, endMs: bestStart + fitMs };
  }
  // Prefer the beginning of the gap if hyperfocus, end if hyperaware.
  if (goal.energyMode === "hyperaware") {
    const endMs = inner.endMs;
    return { startMs: endMs - fitMs, endMs };
  }
  return { startMs: inner.startMs, endMs: inner.startMs + fitMs };
}

function sortBlocksByEnergyCurve(
  blocks: AllocatedBlock[],
  energy: EnergyOrderingSettings
): void {
  blocks.sort((a, b) => a.startMs - b.startMs);
  void energy;
}

/**
 * Achieved wall-time for a goal: union of day-sheet busy (`daysheet-goal:`) and
 * all allocator blocks (auto, drag, actual pins). Overlapping intervals count once
 * so logged + proposed for the same slot is not double-counted in the Plan row.
 */
export function achievedMinutesForGoal(
  goalId: string,
  busy: readonly BusyEvent[],
  blocks: readonly AllocatedBlock[],
  weekStartMs: number,
  weekEndMs: number
): number {
  return mergedGoalCoverageMinutes(goalId, busy, blocks, weekStartMs, weekEndMs);
}

/**
 * Minutes from day-sheet review entries only (`daysheet-goal:<goalId>:`), merged in the week window.
 */
export function loggedMinutesForGoal(
  goalId: string,
  busy: readonly BusyEvent[],
  weekStartMs: number,
  weekEndMs: number
): number {
  const raw: Interval[] = [];
  const prefix = `daysheet-goal:${goalId}:`;
  for (const ev of busy) {
    if (!ev.sourceId?.startsWith(prefix)) continue;
    const c = clipIntervalToWindow({ startMs: ev.startMs, endMs: ev.endMs }, weekStartMs, weekEndMs);
    if (c) raw.push(c);
  }
  const merged = mergeIntervalsSorted(raw);
  return merged.reduce((acc, iv) => acc + Math.floor((iv.endMs - iv.startMs) / MS_PER_MIN), 0);
}

/**
 * Minutes from allocator goal blocks from `nowMs` through week end (merged).
 * When `nowMs` is omitted, uses the full week (same as `weekStartMs`).
 */
export function proposedFutureMinutesForGoal(
  goalId: string,
  blocks: readonly AllocatedBlock[],
  weekStartMs: number,
  weekEndMs: number,
  nowMs: number | undefined
): number {
  const clipStart = Math.max(weekStartMs, nowMs ?? weekStartMs);
  if (clipStart >= weekEndMs) return 0;
  const raw: Interval[] = [];
  for (const b of blocks) {
    if (b.segment || b.goalId !== goalId) continue;
    const c = clipIntervalToWindow({ startMs: b.startMs, endMs: b.endMs }, clipStart, weekEndMs);
    if (c) raw.push(c);
  }
  const merged = mergeIntervalsSorted(raw);
  return merged.reduce((acc, iv) => acc + Math.floor((iv.endMs - iv.startMs) / MS_PER_MIN), 0);
}

function clipIntervalToWindow(iv: Interval, windowStartMs: number, windowEndMs: number): Interval | null {
  const startMs = Math.max(iv.startMs, windowStartMs);
  const endMs = Math.min(iv.endMs, windowEndMs);
  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

function mergeIntervalsSorted(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const out: Interval[] = [];
  let cur = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (n.startMs <= cur.endMs) {
      cur = { startMs: cur.startMs, endMs: Math.max(cur.endMs, n.endMs) };
    } else {
      out.push(cur);
      cur = n;
    }
  }
  out.push(cur);
  return out;
}

function mergedGoalCoverageMinutes(
  goalId: string,
  busy: readonly BusyEvent[],
  blocks: readonly AllocatedBlock[],
  weekStartMs: number,
  weekEndMs: number
): number {
  const raw: Interval[] = [];
  const prefix = `daysheet-goal:${goalId}:`;
  for (const ev of busy) {
    if (!ev.sourceId?.startsWith(prefix)) continue;
    const c = clipIntervalToWindow({ startMs: ev.startMs, endMs: ev.endMs }, weekStartMs, weekEndMs);
    if (c) raw.push(c);
  }
  for (const b of blocks) {
    if (b.segment || b.goalId !== goalId) continue;
    const c = clipIntervalToWindow({ startMs: b.startMs, endMs: b.endMs }, weekStartMs, weekEndMs);
    if (c) raw.push(c);
  }
  const merged = mergeIntervalsSorted(raw);
  return merged.reduce((acc, iv) => acc + Math.floor((iv.endMs - iv.startMs) / MS_PER_MIN), 0);
}

function goalBlockMinutesPlaced(goalId: string, blocks: readonly AllocatedBlock[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.segment || b.goalId !== goalId) continue;
    n += Math.floor((b.endMs - b.startMs) / MS_PER_MIN);
  }
  return n;
}

function computeMetrics(
  plan: WeeklyPlan,
  prepared: readonly PreparedGoal[],
  blocks: readonly AllocatedBlock[],
  days: { startMs: number; endMs: number; gaps: Interval[] }[],
  settings: UserSettings,
  nowMs: number | undefined,
  busy: readonly BusyEvent[],
  weekStartMs: number,
  weekEndMs: number,
  goalOverrides: ReadonlyMap<string, { startMs: number; endMs: number }>,
  goalOverrideSources: ReadonlyMap<string, "drag" | "actual">,
  weekCapacityMinutes: number,
  weekCapacityFromNowMinutes: number,
  utilisationDiagnostics: {
    grossWeekMinutes: number;
    busyWeekMinutes: number;
    consistencyReservedWeekMinutes: number;
    busyTrueEventCount: number;
  },
  goalGroupWeeklyGapsPre: readonly {
    groupId: string;
    reason: "weeklyCap" | "weeklyFloor";
    shortMinutes: number;
  }[],
  /** Placement demand (minutes) after logs / now scaling, captured before Pass 3 — used for `unplacedMinutes`. */
  placementDemandBeforePass3?: ReadonlyMap<string, number>
): WeekMetrics {
  const wheel = settings.wheel;
  const ppf = settings.ppf;
  const fw = settings.schedulerFrameworkInclusion;
  const perGoal: WeekMetrics["perGoal"] = {};
  const preparedById = new Map(prepared.map((p) => [p.goal.id, p] as const));
  for (const g of plan.goals) {
    const p = preparedById.get(g.id);
    const target = p?.plannedWeeklyMinutes ?? g.targetMinutes ?? 0;
    const placementDemand =
      placementDemandBeforePass3?.get(g.id) ?? p?.effectiveMinutes ?? 0;
    const placedBlocks = goalBlockMinutesPlaced(g.id, blocks);
    const achieved = achievedMinutesForGoal(g.id, busy, blocks, weekStartMs, weekEndMs);
    const loggedMinutes = loggedMinutesForGoal(g.id, busy, weekStartMs, weekEndMs);
    const proposedFutureMinutes = proposedFutureMinutesForGoal(
      g.id,
      blocks,
      weekStartMs,
      weekEndMs,
      nowMs
    );
    perGoal[g.id] = {
      targetMinutes: target,
      scheduledMinutes: achieved,
      unplacedMinutes: Math.max(0, placementDemand - placedBlocks),
      loggedMinutes,
      proposedFutureMinutes
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
    const keys = ["personal", "professional", "financial"] as const;
    const exact = keys.map((k) => (ppfMinutes[k] / totalScheduled) * 100);
    const floorPct = exact.map((x) => Math.floor(x));
    let remainder = 100 - floorPct.reduce((a, b) => a + b, 0);
    const byFrac = keys.map((_, i) => i).sort((i, j) => {
      const fi = exact[i]! - floorPct[i]!;
      const fj = exact[j]! - floorPct[j]!;
      return fj - fi || i - j;
    });
    const adjusted = [...floorPct];
    for (let r = 0; r < remainder; r++) {
      const pillarIdx = byFrac[r]!;
      adjusted[pillarIdx] = (adjusted[pillarIdx] ?? 0) + 1;
    }
    for (let i = 0; i < keys.length; i++) {
      ppfPercent[keys[i]!] = adjusted[i]!;
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

  const goalGroupMinutes: Record<string, number> = {};
  const goalGroupGaps: WeekMetrics["goalGroupGaps"] = [...goalGroupWeeklyGapsPre];

  for (const grp of plan.goalGroups ?? []) {
    let sum = 0;
    for (const g of plan.goals) {
      if (!g.groupIds?.includes(grp.id)) continue;
      sum += perGoal[g.id]?.scheduledMinutes ?? 0;
    }
    goalGroupMinutes[grp.id] = sum;

    const norm = normaliseGoalTime(stubWeeklyGoalFromGoalGroup(grp));
    const capDay = norm.maxMinutesPerDay;
    if (capDay === undefined) continue;
    const members = plan.goals.filter((g) => g.groupIds?.includes(grp.id)).map((g) => g.id);
    if (members.length === 0) continue;
    for (let d = 0; d < 7; d++) {
      const day = days[d]!;
      let daySum = 0;
      for (const mid of members) {
        daySum += loggedGoalBusyMinutesForDay(busy, mid, day.startMs, day.endMs);
        for (const b of blocks) {
          if (b.segment || b.goalId !== mid) continue;
          const s = Math.max(b.startMs, day.startMs);
          const e = Math.min(b.endMs, day.endMs);
          if (e > s) daySum += Math.floor((e - s) / MS_PER_MIN);
        }
      }
      if (daySum > capDay) {
        goalGroupGaps.push({
          groupId: grp.id,
          reason: "dailyCap",
          shortMinutes: daySum - capDay,
          dayIndex: d
        });
      }
    }
  }

  const availableMinutes = days.reduce(
    (acc, d) => acc + d.gaps.reduce((a, g) => a + intervalMinutesFull(g), 0),
    0
  );
  const availableFromNowMinutes = days.reduce(
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
    goalGroupMinutes,
    goalGroupGaps,
    utilisation: {
      weekCapacityMinutes,
      weekCapacityFromNowMinutes,
      availableMinutes,
      availableFromNowMinutes,
      scheduledMinutes: totalScheduled,
      grossWeekMinutes: utilisationDiagnostics.grossWeekMinutes,
      busyWeekMinutes: utilisationDiagnostics.busyWeekMinutes,
      consistencyReservedWeekMinutes: utilisationDiagnostics.consistencyReservedWeekMinutes,
      busyTrueEventCount: utilisationDiagnostics.busyTrueEventCount
    },
    notScheduled: []
  };
}

// Re-export day-key helper for callers building per-day fixtures.
export { dateKeyInTz };
