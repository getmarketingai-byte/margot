/**
 * Perfect-week allocator.
 *
 * Product/business rules: see [ALLOCATOR_BUSINESS_RULES.md](../ALLOCATOR_BUSINESS_RULES.md).
 *
 * Module layout:
 * - [`weekly-grid.ts`](weekly-grid.ts) — quantum grid (`QUANTUM`).
 * - Pass 12 prep `buildAllocateWeekPass12Prep` / `baselineWeeklyMinuteTargets`,
 *   distribution (`distributeMinutes`, catch‑up overlays), geometry, Pass 3 greedy
 *   placement, and `computeMetrics` are implemented in this file; further splitting
 *   can peel metrics or placement without API changes (`@calendar-automations/planner`
 *   re-exports stay on `weekly.ts`).
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
 *          — placement iterates favoured days vs overlap with those windows so
 *            constrained rows precede greedy consumption of sunny pockets by
 *            unconstrained goals
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
 *      `placementIdealClockTimes` (optionally narrowed by after/before boundaries
 *      or legacy `placementIdealClockFilter`) bias gap choice and in-gap start alignment;
 *      when after+before form a hard band, Pass 1–2 weekly targets are capped to
 *      placeable time in that band (merged with explicit `maxMinutesPerWeek`).
 *      Prefer a Perfect Week goal row with `specialGoalType: "gym"` for ordering;
 *      otherwise `gym.plannerBlockEnabled` still injects a synthetic fallback.
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
  effectivePlacementIdealAfterBoundary,
  effectivePlacementIdealBeforeBoundary,
  hybridLinearPlacementBlocksTimemaps,
  hybridHasMixedLinearTimemapBlocking,
  effectiveWeeklyGoalWindowPlacement,
  filterSchedulingGoals,
  hydrateFrameworkSystemMirrors,
  isInvertedTimemapGoal,
  normaliseGoalTime,
  stubWeeklyGoalFromGoalGroup
} from "@calendar-automations/schema";
import type { BusyEvent, Interval } from "./types";
import {
  computeStackedFeasibleWindowsForWeek,
  dayHardPlacementIdealWindow,
  intersectWithAvailability,
  placementWindowsForDay,
  type WeekDayGapBuckets
} from "./goal-feasible-windows";
import { collectBusyIntervals, freeGaps, mergeIntervals, subtractIntervalsFromUnion } from "./intervals";
import { physicalActivityWeeklyGoalFromGymSettings } from "./weekly-routines";
import { hourInTz, dateKeyInTz, localMidnightMs } from "./time";
import { QUANTUM } from "./weekly-grid";

const MS_PER_MIN = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Pass‑0 "non-adjacent spread" is low priority: at most this many deferrals per goal per week. */
const PASS0_NONADJ_SPREAD_MAX_DEFERRALS_PER_WEEK = 2;
/**
 * Only consider pass‑0 non-adjacent spread when Pass‑3 demand is at or below this
 * (minutes). Heavier rows skip the rule so Fri→Sat and large stacks stay placeable.
 */
const PASS0_NONADJ_SPREAD_MAX_DEMAND_FOR_RULE_MIN = 12 * 60;
/** Reference waking-day busy proxy (14h) for normalising calendar load to 0–1. */
const DRAIN_REF_MS = 14 * 60 * MS_PER_MIN;

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
   * - `demandMinutesBeforePass3`: weekly minutes the allocator still wants placed after day-sheet log
   *   credit and optional `allocationNowMs` from-now scaling — same basis as `unplacedMinutes +` blocks
   *   placed in Pass 3, but captured before Pass 3. Use for cohort fair-share UI vs `targetMinutes`.
   * - `scheduledMinutes`: achieved = merged union of day-sheet (`daysheet-goal:`) and goal block intervals (see ALLOCATOR_BUSINESS_RULES.md).
   * - `loggedMinutes` / `proposedFutureMinutes`: day-sheet-only and future-block-only (for UI); can overlap the same wall time, so they need not sum to `scheduledMinutes`.
   * - `unplacedMinutes`: placement demand after log credit still unmet by calendar blocks (>= 0).
   */
  perGoal: Record<
    string,
    {
      scheduledMinutes: number;
      targetMinutes: number;
      /** Demand after log / from-now adjustments, before Pass 3 (see interface doc). */
      demandMinutesBeforePass3: number;
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
   * Pass‑2 minutes per goal after group weekly caps: `plannedWeeklyMinutes −` minutes
   * reserved at the start of Pass 2 (Pass‑1 floors). Same cohort as the allocator;
   * used to align Perfect Week fair-share hints with `goalsForAllocation` (wheel, etc.).
   */
  allocatorRemainderHintByGoalId: Record<string, number>;
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
   * Optional mid-week overlay from review rollups or manual weekly review.
   * Applied **after** Pass 1+2 and weekly group caps: adds or subtracts
   * `plannedWeeklyMinutes` and `effectiveMinutes` together **per goal**, without
   * reshuffling other goals' Pass‑2 remainder split (unlike historical Pass‑1
   * floor inflation). Positive = catch‑up demand; negative = trim (still
   * respects weekly min / max). `maxMinutesPerWeek` remains a ceiling.
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
  /**
   * Present when `settings.allocator.goalWindowMode === "stacked"`: per-goal union of
   * intervals where Pass‑3 constraints allow scheduling (Skedpal envelope).
   */
  stackedFeasibleByGoalId?: Record<string, Interval[]>;
  /**
   * Hybrid + mixed linear timemap blocking only: wider ribbon intervals for dashboard preview.
   * Pre-linear stacked envelope minus **blocking** hybrid linear placement only (non-blocking linear
   * rows do not clip ribbons). Placement/stacked pins still use {@link stackedFeasibleByGoalId}.
   */
  stackedFeasibleRibbonPreviewByGoalId?: Record<string, Interval[]>;
}

/** Internal: a goal augmented with the bounds the allocator actually uses. */
export interface PreparedGoal {
  goal: WeeklyGoal;
  norm: NormalisedGoalTime;
  /**
   * Explicit weekly minimum from schema (`normaliseGoalTime`).
   * Pass 2 excludes goals with a positive weekly floor and no `%`.
   */
  weeklyFloorBeforeCatchUpBump: number;
  /** Pass 1+2 planned weekly minutes (full-week budget). */
  plannedWeeklyMinutes: number;
  /**
   * Minutes still to place after day-sheet credit (what Pass 3 tries to schedule).
   * Alias: placement demand.
   */
  effectiveMinutes: number;
  /**
   * `effectiveMinutes` after Pass 1 (and starvation shrink if any), before Pass 2 rounds.
   * Used with post–cap `plannedWeeklyMinutes` for Pass‑2 fair-share hints.
   */
  pass1EndEffectiveMinutes: number;
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

type WeekDayBuckets = {
  startMs: number;
  endMs: number;
  gaps: Interval[];
};

/** Busy grid + goal list shared by allocateWeek Pass 1–2 baseline and rollup targets. */
function buildAllocateWeekPass12Prep(
  input: AllocateInput,
  segmentBlocksScratch: AllocatedBlock[],
  segmentBlocksByDay?: AllocatedBlock[][]
): {
  plan: WeeklyPlan;
  busy: readonly BusyEvent[];
  settings: UserSettings;
  tz: string;
  weekStartMs: number;
  weekEndMs: number;
  grossWeekMinutes: number;
  minutesOpenBeforeConsistency: number;
  busyWeekMinutes: number;
  busyTrueEventCount: number;
  consistencyReservedWeekMinutes: number;
  days: WeekDayBuckets[];
  weekCapacityMinutes: number;
  weekCapacityFromNowMinutes: number;
  allocationNowMs: number | undefined;
  goalsForAllocation: WeeklyGoal[];
  hardWindowWeeklyCaps: Map<string, number>;
  dayDrainScores: number[] | undefined;
  batteryContext:
    | {
        goalsById: ReadonlyMap<string, WeeklyGoal>;
        dayDrainScores: readonly number[];
        personalSystem: PersonalSystem;
      }
    | undefined;
  fw: SchedulerFrameworkInclusion;
} {
  const { plan, busy, settings: incomingSettings } = input;
  const settings = hydrateFrameworkSystemMirrors(incomingSettings);
  const tz = plan.timezone || settings.timezone;
  const weekStartMs = input.weekStartMs ?? parseLocalDateMs(plan.weekStart, tz);
  const weekEndMs = input.weekEndMs ?? weekStartMs + 7 * DAY_MS;
  const allocationNowMs = input.nowMs;

  const days: WeekDayBuckets[] = [];
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

  if (settings.consistency.enabled) {
    for (const seg of settings.consistency.segments) {
      if (!seg.nonNegotiable) continue;
      reserveSegment(seg, days, weekStartMs, tz, segmentBlocksScratch, segmentBlocksByDay);
    }
  }

  const schedulingGoalsBase = plan.goals
    .filter((g) => !isInvertedTimemapGoal(g))
    .map((g) => mergeGoalGroupPlacementSchedulingOntoGoal(plan, g));
  const planGymGoals = schedulingGoalsBase.filter((g) => g.specialGoalType === "gym");
  const nonGym = schedulingGoalsBase.filter((g) => g.specialGoalType !== "gym");
  const settingsSynthetic = physicalActivityWeeklyGoalFromGymSettings(settings.gym);
  const schedulingGoals = nonGym;
  const routineInject: WeeklyGoal[] =
    planGymGoals.length > 0 ? [...planGymGoals] : settingsSynthetic ? [settingsSynthetic] : [];
  const fw = settings.schedulerFrameworkInclusion;
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

  const hardWindowWeeklyCaps = new Map<string, number>();
  for (const g of goalsForAllocation) {
    const cap = weeklyHardIdealWindowMaxPlaceableMinutes(
      g,
      days,
      tz,
      input.goalAvailabilityWindows?.[g.id],
      input.niceWeatherWindows
    );
    if (cap !== undefined) hardWindowWeeklyCaps.set(g.id, cap);
  }

  return {
    plan,
    busy,
    settings,
    tz,
    weekStartMs,
    weekEndMs,
    grossWeekMinutes,
    minutesOpenBeforeConsistency,
    busyWeekMinutes,
    busyTrueEventCount,
    consistencyReservedWeekMinutes,
    days,
    weekCapacityMinutes,
    weekCapacityFromNowMinutes,
    allocationNowMs,
    goalsForAllocation,
    hardWindowWeeklyCaps,
    dayDrainScores,
    batteryContext,
    fw
  };
}

/** Weekly Pass‑1/2 targets (`plannedWeeklyMinutes`) before catch‑up, logs, and Pass 3 — for pace rollups without nesting a full `allocateWeek`. */
export function baselineWeeklyMinuteTargets(input: AllocateInput): Record<string, number> {
  const segmentScratch: AllocatedBlock[] = [];
  const prep = buildAllocateWeekPass12Prep(input, segmentScratch);
  const { prepared } = distributeMinutes(
    prep.goalsForAllocation,
    prep.weekCapacityMinutes,
    prep.settings.allocator,
    prep.hardWindowWeeklyCaps
  );
  const scratchGaps: Array<{ groupId: string; reason: "weeklyCap" | "weeklyFloor"; shortMinutes: number }> = [];
  applyGoalGroupWeeklyCaps(prepared, prep.plan, prep.weekCapacityMinutes, scratchGaps);
  const out: Record<string, number> = {};
  for (const p of prepared) out[p.goal.id] = p.plannedWeeklyMinutes;
  return out;
}

export function allocateWeek(input: AllocateInput): AllocateResult {
  const sleepIntervals = input.sleepIntervals;
  const goalOverrideSources =
    input.goalOverrideSources ?? goalOverrideSourcesFromPlan(input.plan);
  const goalOverrides = new Map<string, { startMs: number; endMs: number }>();
  for (const o of input.plan.overrides ?? []) {
    if (o.kind === "goal") goalOverrides.set(o.key, { startMs: o.startMs, endMs: o.endMs });
  }

  const weekAnchorDate = input.weekAnchorDate ?? input.plan.weekStart;
  const allocationNowMs = input.nowMs;

  const blocksByDay: AllocatedBlock[][] = Array.from({ length: 7 }, () => []);
  const blocks: AllocatedBlock[] = [];

  const prep = buildAllocateWeekPass12Prep(input, blocks, blocksByDay);
  const {
    plan,
    busy,
    settings,
    tz,
    weekStartMs,
    weekEndMs,
    grossWeekMinutes,
    busyWeekMinutes,
    consistencyReservedWeekMinutes,
    busyTrueEventCount,
    days,
    weekCapacityMinutes,
    weekCapacityFromNowMinutes,
    goalsForAllocation,
    hardWindowWeeklyCaps,
    fw,
    batteryContext,
    dayDrainScores
  } = prep;

  const batteryOn = batteryContext !== undefined;

  /** Matches schema default; callers/tests may shallow-merge `allocator` and omit this field. */
  const goalWindowMode = settings.allocator.goalWindowMode ?? "linear";
  const { placementGoalOverrides, placementGoalOverrideSources } =
    goalWindowMode === "stacked"
      ? {
          placementGoalOverrides: new Map<string, { startMs: number; endMs: number }>(),
          placementGoalOverrideSources: new Map<string, "drag" | "actual">()
        }
      : goalWindowMode === "hybrid"
        ? filterHybridPlacementOverrides(goalOverrides, goalOverrideSources, goalsForAllocation)
        : {
            placementGoalOverrides: goalOverrides,
            placementGoalOverrideSources: goalOverrideSources
          };

  const { prepared, overcommitted, notScheduled } = distributeMinutes(
    goalsForAllocation,
    weekCapacityMinutes,
    settings.allocator,
    hardWindowWeeklyCaps
  );

  const goalGroupWeeklyGapsPre: Array<{
    groupId: string;
    reason: "weeklyCap" | "weeklyFloor";
    shortMinutes: number;
  }> = [];
  applyGoalGroupWeeklyCaps(prepared, plan, weekCapacityMinutes, goalGroupWeeklyGapsPre);

  applyCatchUpDemandAdjustments(prepared, input.catchUpFloors, weekCapacityMinutes);

  const groupPlacement = initGoalGroupPlacementContext(plan, busy, placementGoalOverrides, days);

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
      placementGoalOverrides,
      placementGoalOverrideSources
    );
    const unpinnedLoggedMinutes = Math.max(0, weeklyLoggedMinutes - weeklyPinnedActualMinutes);
    p.effectiveMinutes = Math.max(0, p.effectiveMinutes - unpinnedLoggedMinutes);
  }

  if (allocationNowMs !== undefined) {
    const schedulable = prepared.filter((p) => {
      if (p.effectiveMinutes <= 0) return false;
      // Hybrid: from‑now capacity budgets greedy linear placement; stacked‑role rows
      // do not consume those gaps with Pass‑3 auto blocks — exclude them here so they
      // do not dilute linear peers (same rationale as invert‑calendar cohort split).
      if (
        goalWindowMode === "hybrid" &&
        effectiveWeeklyGoalWindowPlacement(p.goal, goalWindowMode) === "stacked"
      ) {
        return false;
      }
      return true;
    });
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

  // Pass 3 only packs into `placementWindowsForDay` (invert-calendar, nice-weather,
  // hard ideal clock). Raw `weekCapacityFromNowMinutes` can still count evening gaps
  // when a row is restricted to morning windows that are already past — trim demand so
  // we do not show Pass‑2 targets that Pass 3 can never place from `nowMs`.
  if (allocationNowMs !== undefined) {
    for (const p of prepared) {
      if (p.effectiveMinutes <= 0) continue;
      const placeable = futurePass3PlaceableMinutesFromNowForGoal(
        p.goal,
        days,
        tz,
        input.goalAvailabilityWindows?.[p.goal.id],
        input.niceWeatherWindows,
        allocationNowMs
      );
      if (placeable < p.effectiveMinutes) {
        p.effectiveMinutes = placeable;
      }
    }
  }

  // Goals that reuse the **same** merged invert-calendar interval list compete for one
  // physical pocket of future placement time. Solo caps above each allow the full
  // pocket per row, which can over-commit (sum of demands > pocket). Split the
  // pocket across the cohort on the same quantised grid as Pass‑2 remainder splits.
  if (allocationNowMs !== undefined && input.goalAvailabilityWindows) {
    const av = input.goalAvailabilityWindows;
    const groups = new Map<string, PreparedGoal[]>();
    for (const p of prepared) {
      if (p.effectiveMinutes <= 0) continue;
      // Hybrid: invert-calendar cohort splitting proportions greedy Pass‑3 demand across
      // goals that share one physical pocket. Stacked-role rows do not consume that pocket
      // with greedy blocks (pins-only wave); keep them out so linear peers are not diluted.
      if (
        goalWindowMode === "hybrid" &&
        effectiveWeeklyGoalWindowPlacement(p.goal, goalWindowMode) === "stacked"
      ) {
        continue;
      }
      const win = av[p.goal.id];
      if (!win || win.length === 0) continue;
      const key = invertCalendarAvailabilityCohortKey(win, p.goal.scheduleInNiceWeather === true);
      const list = groups.get(key) ?? [];
      list.push(p);
      groups.set(key, list);
    }
    for (const [, members] of groups) {
      if (members.length < 2) continue;
      const caps = members.map((m) =>
        futurePass3PlaceableMinutesFromNowForGoal(
          m.goal,
          days,
          tz,
          av[m.goal.id],
          input.niceWeatherWindows,
          allocationNowMs
        )
      );
      const sharedBudget = Math.min(...caps);
      const sumEff = members.reduce((a, m) => a + m.effectiveMinutes, 0);
      if (sumEff <= sharedBudget) continue;
      const weights = members.map((m) => m.effectiveMinutes);
      const alloc = proportionalMinutesOnGrid(weights, sharedBudget);
      for (let i = 0; i < members.length; i++) {
        members[i]!.effectiveMinutes = alloc[i] ?? 0;
      }
    }
  }

  /** Free gaps after segments, before goals — used to even out inter-goal slack in "even" mode. */
  const gapsBeforeGoals = days.map((d) => d.gaps.map((g) => ({ ...g })));

  if (allocationNowMs !== undefined) {
    for (const p of prepared) {
      if (p.effectiveMinutes <= 0) continue;
      const minBlk = minMinutesPerBlockFloor(p.goal);
      const mx = maxFuturePlacementGapMinutesAcrossWeek(
        p.goal,
        days,
        gapsBeforeGoals,
        tz,
        input.goalAvailabilityWindows?.[p.goal.id],
        input.niceWeatherWindows,
        allocationNowMs
      );
      if (minBlk > 0 && mx < minBlk) {
        p.effectiveMinutes = 0;
      }
    }
  }

  // Pass 3 — placement: schedule each prepared goal, day by day, honouring
  // per-day caps. Order matters when free time is scarce, so we sort:
  //   1. commitment tier (non-negotiable → committed → nice-to-have),
  //   2. weekly-floor goals first (`weeklyFloorBeforeCatchUpBump`, so catch-up-only
  //      bumps do not reorder ahead of true equal-share peers),
  //   3. gym goals next (they consume drive pads — must run before fillers),
  //   4. nice-weather–constrained rows (scarcer windows) before unconstrained peers,
  //   5. **plan list order** (`index` — same order as goals in the weekly plan),
  //   6. larger remaining demand last as a weak tie-breaker.
  prepared.sort((a, b) => comparePreparedGoalsForPass3Placement(a, b, fw));
  const placementDemandBeforePass3 = new Map(
    prepared.map((p) => [p.goal.id, p.effectiveMinutes] as const)
  );

  const feasibilityOpts = {
    tz,
    goalAvailabilityWindows: input.goalAvailabilityWindows,
    niceWeatherWindows: input.niceWeatherWindows,
    nowMs: allocationNowMs,
    weekStartMs,
    weekEndMs,
    hardWindowWeeklyCaps
  } as const;

  let stackedFeasibleByGoalId: Record<string, Interval[]> | undefined;

  if (goalWindowMode === "linear") {
    stackedFeasibleByGoalId = undefined;
  } else if (goalWindowMode === "stacked") {
    stackedFeasibleByGoalId = computeStackedFeasibleWindowsForWeek({
      goals: prepared.map((p) => p.goal),
      days,
      ...feasibilityOpts
    });
  } else {
    const anyLinearBlocksTimemaps = prepared.some((p) =>
      hybridLinearPlacementBlocksTimemaps(p.goal, goalWindowMode)
    );
    const hasAnyStackedRole = prepared.some(
      (p) => effectiveWeeklyGoalWindowPlacement(p.goal, goalWindowMode) === "stacked"
    );
    stackedFeasibleByGoalId = hasAnyStackedRole ? {} : undefined;
    if (stackedFeasibleByGoalId && !anyLinearBlocksTimemaps) {
      const stackedGoals = prepared
        .filter((p) => effectiveWeeklyGoalWindowPlacement(p.goal, goalWindowMode) === "stacked")
        .map((p) => p.goal);
      if (stackedGoals.length > 0) {
        Object.assign(
          stackedFeasibleByGoalId,
          computeStackedFeasibleWindowsForWeek({
            goals: stackedGoals,
            days: cloneWeekDayGapBuckets(days),
            ...feasibilityOpts
          })
        );
      }
    }
  }

  const hybridPreLinearGapSnapshot =
    goalWindowMode === "hybrid" ? cloneWeekDayGapBuckets(days) : undefined;

  const pass3Sequential = prepared.filter(
    (p) => p.goal.specialGoalType === "gym" || p.weeklyFloorBeforeCatchUpBump > 0
  );
  const pass3RoundRobin = prepared.filter(
    (p) => p.goal.specialGoalType !== "gym" && p.weeklyFloorBeforeCatchUpBump <= 0
  );

  const pinsOnlyForPrepared = (p: PreparedGoal) =>
    effectiveWeeklyGoalWindowPlacement(p.goal, goalWindowMode) === "stacked";

  const runAllocateGoalPass3 = (p: PreparedGoal) => {
    if (p.effectiveMinutes <= 0) return;
    allocateGoal(
      p,
      days,
      blocks,
      blocksByDay,
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
      placementGoalOverrides,
      placementGoalOverrideSources,
      allocationNowMs,
      sleepIntervals,
      prepared,
      batteryContext,
      groupPlacement,
      pinsOnlyForPrepared(p)
    );
  };

  const RR_ROUNDS = 128;

  const runPass3RoundRobinWaves = (cohort: PreparedGoal[]): void => {
    const pass3RoundRobinBase = [...cohort].sort((a, b) =>
      comparePreparedGoalsForPass3Placement(a, b, fw)
    );
    for (let r = 0; r < RR_ROUNDS; r++) {
      const placedAutoMinByGoal = new Map<string, number>();
      for (const b of blocks) {
        if (b.segment) continue;
        const gid = b.goalId;
        placedAutoMinByGoal.set(
          gid,
          (placedAutoMinByGoal.get(gid) ?? 0) + Math.floor((b.endMs - b.startMs) / MS_PER_MIN)
        );
      }
      const ordered = [...pass3RoundRobinBase].sort((a, b) => {
        const pa = placedAutoMinByGoal.get(a.goal.id) ?? 0;
        const pb = placedAutoMinByGoal.get(b.goal.id) ?? 0;
        // Fewest auto minutes placed first each wave so peers with equal Pass‑1/2 demand
        // take turns claiming pockets; reversing starves trailing goals when leaders stay hot.
        if (pa !== pb) return pa - pb;
        const aDefer = respectsPeerContinuationPocketsWhenChoosingGaps(a.goal) ? 1 : 0;
        const bDefer = respectsPeerContinuationPocketsWhenChoosingGaps(b.goal) ? 1 : 0;
        if (aDefer !== bDefer) return aDefer - bDefer;
        return comparePreparedGoalsForPass3Placement(a, b, fw);
      });
      let progressed = false;
      for (const p of ordered) {
        if (p.effectiveMinutes < QUANTUM) continue;
        const before = p.effectiveMinutes;
        runAllocateGoalPass3(p);
        if (p.effectiveMinutes < before) progressed = true;
      }
      if (!progressed) break;
    }
  };

  if (goalWindowMode === "hybrid") {
    const linearSequential = pass3Sequential.filter(
      (p) => effectiveWeeklyGoalWindowPlacement(p.goal, goalWindowMode) === "linear"
    );
    const linearRoundRobin = pass3RoundRobin.filter(
      (p) => effectiveWeeklyGoalWindowPlacement(p.goal, goalWindowMode) === "linear"
    );
    for (const p of linearSequential) runAllocateGoalPass3(p);
    runPass3RoundRobinWaves(linearRoundRobin);

    const anyLinearBlocksTimemaps = prepared.some((p) =>
      hybridLinearPlacementBlocksTimemaps(p.goal, goalWindowMode)
    );
    if (anyLinearBlocksTimemaps && stackedFeasibleByGoalId) {
      const stackedGoals = prepared
        .filter((p) => effectiveWeeklyGoalWindowPlacement(p.goal, goalWindowMode) === "stacked")
        .map((p) => p.goal);
      if (stackedGoals.length > 0) {
        Object.assign(
          stackedFeasibleByGoalId,
          computeStackedFeasibleWindowsForWeek({
            goals: stackedGoals,
            days,
            ...feasibilityOpts
          })
        );
      }
    }

    const stackedSequential = pass3Sequential.filter(
      (p) => effectiveWeeklyGoalWindowPlacement(p.goal, goalWindowMode) === "stacked"
    );
    const stackedRoundRobin = pass3RoundRobin.filter(
      (p) => effectiveWeeklyGoalWindowPlacement(p.goal, goalWindowMode) === "stacked"
    );
    for (const p of stackedSequential) runAllocateGoalPass3(p);
    runPass3RoundRobinWaves(stackedRoundRobin);
  } else {
    for (const p of pass3Sequential) runAllocateGoalPass3(p);
    runPass3RoundRobinWaves(pass3RoundRobin);
  }

  for (const b of blocks) {
    if (!b.dragKey || b.segment) continue;
    if (placementGoalOverrides.has(b.dragKey)) {
      b.dragOverrideSaved = true;
      b.overrideSource = placementGoalOverrideSources.get(b.dragKey) ?? "drag";
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

  let stackedFeasibleRibbonPreviewByGoalId: Record<string, Interval[]> | undefined;
  if (
    goalWindowMode === "hybrid" &&
    stackedFeasibleByGoalId &&
    hybridPreLinearGapSnapshot &&
    hybridHasMixedLinearTimemapBlocking(
      prepared.map((p) => p.goal),
      goalWindowMode
    )
  ) {
    const stackedGoals = prepared
      .filter((p) => effectiveWeeklyGoalWindowPlacement(p.goal, goalWindowMode) === "stacked")
      .map((p) => p.goal);
    if (stackedGoals.length > 0) {
      const preLin = computeStackedFeasibleWindowsForWeek({
        goals: stackedGoals,
        days: hybridPreLinearGapSnapshot,
        ...feasibilityOpts
      });
      const blockingChunks: Interval[] = [];
      for (const b of blocks) {
        if (b.segment) continue;
        const prep = prepared.find((q) => q.goal.id === b.goalId);
        if (!prep || !hybridLinearPlacementBlocksTimemaps(prep.goal, goalWindowMode)) continue;
        blockingChunks.push({ startMs: b.startMs, endMs: b.endMs });
      }
      const blockingOccupancy = mergeIntervals(blockingChunks);
      stackedFeasibleRibbonPreviewByGoalId = {};
      for (const [gid, intervals] of Object.entries(preLin)) {
        stackedFeasibleRibbonPreviewByGoalId[gid] = subtractIntervalsFromUnion(
          intervals,
          blockingOccupancy
        );
      }
    }
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
    placementGoalOverrides,
    placementGoalOverrideSources,
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

  return stackedFeasibleByGoalId
    ? {
        blocks,
        metrics,
        stackedFeasibleByGoalId,
        ...(stackedFeasibleRibbonPreviewByGoalId
          ? { stackedFeasibleRibbonPreviewByGoalId }
          : {})
      }
    : { blocks, metrics };
}

/**
 * Pass 1 + Pass 2: derive each goal's `effectiveMinutes` for the week.
 *
 *   - Pass 1 reserves every goal's `minMinutesPerWeek` as a floor.
 *   - Pass 2 distributes the remaining free time after floors: `%` goals target
 *     `(pct/100) * T` where `T` is full-week schedulable gap time (`totalFreeMin`);
 *     the cohort never receives more than remainder `R` after Pass 1. **Hybrid /
 *     stacked window mode:** stacked-role rows with `%` skip this remainder cohort and
 *     receive `pct × T` afterward so `%` sizes stacked timemaps without shrinking peers’ R-split.
 *     Goals with no `%` split whatever is left after those targets (or share `R` evenly when
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
  hardIdealWindowWeeklyCaps?: ReadonlyMap<string, number>
): {
  prepared: PreparedGoal[];
  overcommitted: WeekMetrics["overcommitted"];
  notScheduled: WeekMetrics["notScheduled"];
} {
  const prepared: PreparedGoal[] = goals.map((goal, index) => {
    const norm = normaliseGoalTime(goal);
    const weeklyFloorBeforeCatchUpBump = norm.minMinutesPerWeek ?? 0;
    const winCap = hardIdealWindowWeeklyCaps?.get(goal.id);
    if (winCap !== undefined) {
      const qc = Math.max(0, Math.floor(winCap / QUANTUM) * QUANTUM);
      norm.maxMinutesPerWeek =
        norm.maxMinutesPerWeek === undefined ? qc : Math.min(norm.maxMinutesPerWeek, qc);
      if (norm.minMinutesPerWeek !== undefined && norm.maxMinutesPerWeek !== undefined) {
        norm.minMinutesPerWeek = Math.min(norm.minMinutesPerWeek, norm.maxMinutesPerWeek);
      }
    }
    return {
      goal,
      norm,
      weeklyFloorBeforeCatchUpBump,
      plannedWeeklyMinutes: 0,
      effectiveMinutes: 0,
      pass1EndEffectiveMinutes: 0,
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
      p.pass1EndEffectiveMinutes = p.effectiveMinutes;
      p.plannedWeeklyMinutes = p.effectiveMinutes;
    }
    return { prepared, overcommitted, notScheduled };
  }

  let remainder = totalFreeMin - floorTotal;
  const remainderPass2Start = remainder;

  const allocatorGoalWindowMode = allocator.goalWindowMode ?? "linear";

  // Pass 2: `%` rows target (pct/100)*T of full-week schedulable time T; the pool
  // for this pass is remainder R after floors. See `computePass2AllocMinutesFromShareOfWeek`.
  //
  // Under **hybrid** or global **stacked** window mode, **stacked-role** rows with an explicit
  // `allocationSharePercent` opt **out** of this remainder split: `%` sizes the stacked timemap
  // target (`pct × T`) without shrinking peers’ Pass‑2 shares. Those targets are applied after
  // the Pass‑2 loop (still respecting weekly min/max via `maxPlannedMinutesForAllocationSharePercent`).
  //
  // Fractions / caps MUST use the same cohort as `eligible()` below.

  const eligible = () =>
    prepared.filter((p) => {
      const cap = p.norm.maxMinutesPerWeek;
      if (cap !== undefined && p.effectiveMinutes >= cap) return false;
      // Only an **explicit** `minMinutesPerWeek` on the goal opts out of Pass 2
      // remainder sharing. A weekly min inferred solely from `minMinutesPerDay`
      // (see `normaliseGoalTime`) is still a Pass‑1 floor but the row should join
      // the equal‑share / `%` cohort for minutes above that floor — otherwise
      // "≥ 30 min/day" incorrectly caps the whole week at 7×30.
      if (
        p.goal.minMinutesPerWeek !== undefined &&
        p.goal.allocationSharePercent === undefined
      ) {
        return false;
      }
      if (
        allocatorGoalWindowMode !== "linear" &&
        p.goal.allocationSharePercent !== undefined &&
        effectiveWeeklyGoalWindowPlacement(p.goal, allocatorGoalWindowMode) === "stacked"
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

  if (allocatorGoalWindowMode !== "linear") {
    for (const p of prepared) {
      if (p.goal.allocationSharePercent === undefined) continue;
      if (effectiveWeeklyGoalWindowPlacement(p.goal, allocatorGoalWindowMode) !== "stacked") continue;
      const upper = maxPlannedMinutesForAllocationSharePercent(p.goal, p.norm, T);
      if (upper === undefined) continue;
      const floorAtPass1 = baseEffectiveByIndex.get(p.index) ?? 0;
      let target = quantise(Math.max(floorAtPass1, upper));
      const maxW = p.norm.maxMinutesPerWeek;
      if (maxW !== undefined) target = Math.min(target, maxW);
      target = Math.max(floorAtPass1, target);
      p.effectiveMinutes = target;
    }
  }

  for (const p of prepared) {
    p.pass1EndEffectiveMinutes = baseEffectiveByIndex.get(p.index) ?? 0;
    p.plannedWeeklyMinutes = p.effectiveMinutes;
  }

  return { prepared, overcommitted, notScheduled };
}

function quantise(min: number): number {
  return Math.max(0, Math.round(min / QUANTUM) * QUANTUM);
}

/** Largest multiple of QUANTUM not exceeding `min` — avoids exceeding caps when shrinking. */
function floorToQuantum(min: number): number {
  return Math.max(0, Math.floor(Math.max(0, min) / QUANTUM) * QUANTUM);
}

/** Converts day-sheet rollup / manual review adjustments onto the allocation grid with sign preserved. */
function quantiseCatchUpAdjustment(delta: number): number {
  if (!Number.isFinite(delta) || delta === 0) return 0;
  const sign = delta > 0 ? 1 : -1;
  return sign * quantise(Math.abs(delta));
}

/** Upper bound on total weekly target from `% of full-week schedulable time` (same quantum as Pass 2). */
function maxPlannedMinutesForAllocationSharePercent(
  goal: WeeklyGoal,
  norm: NormalisedGoalTime,
  weekCapacityMinutes: number
): number | undefined {
  if (goal.allocationSharePercent === undefined || weekCapacityMinutes <= 0) return undefined;
  const frac = Math.min(100, Math.max(0, goal.allocationSharePercent)) / 100;
  let cap = quantise(frac * weekCapacityMinutes);
  if (norm.maxMinutesPerWeek !== undefined) cap = Math.min(cap, norm.maxMinutesPerWeek);
  return cap;
}

/**
 * Catch-up can raise `plannedWeeklyMinutes` without going through Pass 2's `%×T` slice cap.
 * Treat explicit `% of week` as a **ceiling** on the weekly target (after `maxMinutesPerWeek`, if any).
 */
function clampPreparedGoalsToAllocationShareWeekCeiling(
  prepared: PreparedGoal[],
  weekCapacityMinutes: number
): void {
  if (!(weekCapacityMinutes > 0)) return;
  for (const p of prepared) {
    const upper = maxPlannedMinutesForAllocationSharePercent(p.goal, p.norm, weekCapacityMinutes);
    if (upper === undefined) continue;
    const minKeep = Math.max(p.pass1EndEffectiveMinutes, p.norm.minMinutesPerWeek ?? 0);
    if (minKeep > upper) continue;
    if (p.plannedWeeklyMinutes <= upper && p.effectiveMinutes <= upper) continue;
    const nextPlanned = quantise(Math.min(p.plannedWeeklyMinutes, upper));
    p.plannedWeeklyMinutes = Math.max(minKeep, nextPlanned);
    p.effectiveMinutes = Math.max(0, Math.min(p.effectiveMinutes, p.plannedWeeklyMinutes));
  }
}

/**
 * Goal-local catch-up after Pass 1+2 and weekly group caps — does **not** pass through `distributeMinutes`,
 * so other goals keep their Pass‑2 splits. Applies only to goals listed with non-zero deltas.
 */
function applyCatchUpDemandAdjustments(
  prepared: PreparedGoal[],
  catchUpFloors: Readonly<Record<string, number>> | undefined,
  weekCapacityMinutes: number
): void {
  if (catchUpFloors) {
    for (const p of prepared) {
      const raw = catchUpFloors[p.goal.id];
      if (raw === undefined || raw === 0) continue;
      const delta = quantiseCatchUpAdjustment(raw);
      if (delta === 0) continue;

      const minPlanned = p.weeklyFloorBeforeCatchUpBump;
      const maxPlanned = p.norm.maxMinutesPerWeek;

      if (delta > 0) {
        let room =
          maxPlanned === undefined
            ? delta
            : Math.max(0, maxPlanned - p.plannedWeeklyMinutes);
        const add = floorToQuantum(Math.min(delta, room));
        if (add <= 0) continue;
        p.plannedWeeklyMinutes += add;
        p.effectiveMinutes += add;
        if (maxPlanned !== undefined) {
          p.plannedWeeklyMinutes = Math.min(p.plannedWeeklyMinutes, maxPlanned);
          p.effectiveMinutes = Math.min(p.effectiveMinutes, maxPlanned);
        }
      } else {
        const loss = -delta;
        const canTrimFromPlanned = Math.max(0, p.plannedWeeklyMinutes - minPlanned);
        const sub = floorToQuantum(Math.min(loss, canTrimFromPlanned));
        if (sub <= 0) continue;
        p.plannedWeeklyMinutes -= sub;
        p.effectiveMinutes = Math.max(0, p.effectiveMinutes - sub);
        p.plannedWeeklyMinutes = Math.max(minPlanned, p.plannedWeeklyMinutes);
        if (maxPlanned !== undefined) {
          p.plannedWeeklyMinutes = Math.min(p.plannedWeeklyMinutes, maxPlanned);
        }
        p.effectiveMinutes = Math.min(p.effectiveMinutes, p.plannedWeeklyMinutes);
      }
    }
  }
  clampPreparedGoalsToAllocationShareWeekCeiling(prepared, weekCapacityMinutes);
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

/** Shallow clone gap intervals so feasibility snapshots do not alias mutating `days`. */
function cloneWeekDayGapBuckets(days: readonly WeekDayGapBuckets[]): WeekDayGapBuckets[] {
  return days.map((d) => ({
    startMs: d.startMs,
    endMs: d.endMs,
    gaps: d.gaps.map((g) => ({ startMs: g.startMs, endMs: g.endMs }))
  }));
}

function filterHybridPlacementOverrides(
  goalOverrides: ReadonlyMap<string, { startMs: number; endMs: number }>,
  goalOverrideSources: ReadonlyMap<string, "drag" | "actual">,
  goalsForAllocation: readonly WeeklyGoal[]
): {
  placementGoalOverrides: Map<string, { startMs: number; endMs: number }>;
  placementGoalOverrideSources: Map<string, "drag" | "actual">;
} {
  const stackedIds = new Set(
    goalsForAllocation
      .filter((g) => effectiveWeeklyGoalWindowPlacement(g, "hybrid") === "stacked")
      .map((g) => g.id)
  );
  const placementGoalOverrides = new Map(goalOverrides);
  const placementGoalOverrideSources = new Map(goalOverrideSources);
  for (const key of [...placementGoalOverrides.keys()]) {
    const gid = goalIdFromGoalDragKey(key);
    if (gid !== undefined && stackedIds.has(gid)) {
      placementGoalOverrides.delete(key);
      placementGoalOverrideSources.delete(key);
    }
  }
  return { placementGoalOverrides, placementGoalOverrideSources };
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
      // snapshot would violate those bounds. (We also must not reflow sparse
      // pockets after placement: nice-weather / ideal-clock / hard-window blocks
      // are positioned within sub-ranges of G; shifting them for aesthetics
      // breaks those constraints.)
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
  blocks: AllocatedBlock[],
  blocksByDay?: AllocatedBlock[][]
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
    const blk: AllocatedBlock = {
      goalId: `segment:${seg.id}`,
      title: seg.title,
      startMs,
      endMs,
      energyMode: seg.energyMode,
      segment: true
    };
    blocks.push(blk);
    blocksByDay?.[d]?.push(blk);
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

/**
 * Scheduling fields that can be defined on a {@link GoalGroup} and apply to
 * each member goal when omitted on the member (Planning Hub pattern).
 * `daysOfWeek` / `dayOfWeek` are included so hard-window weekly caps count only
 * group-pinned weekdays (otherwise members float all seven days and the cap is
 * inflated up to 7× the band).
 */
const GOAL_GROUP_PLACEMENT_MERGE_KEYS = [
  "placementIdealClockAfter",
  "placementIdealClockBefore",
  "placementIdealClockTimes",
  "placementIdealClockFilter",
  "scheduleInNiceWeather",
  "earliestHour",
  "latestHour",
  "daysOfWeek",
  "dayOfWeek",
  "minMinutesPerBlock",
  "maxAutoBlocksPerDay"
] as const satisfies readonly (keyof GoalGroup)[];

/** Quantised minimum contiguous auto-block size (0 = unset). */
function minMinutesPerBlockFloor(goal: WeeklyGoal): number {
  const raw = goal.minMinutesPerBlock;
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return 0;
  return quantise(Math.min(24 * 60, Math.max(QUANTUM, raw)));
}

/**
 * Cap on auto-generated blocks per calendar day (pins excluded).
 *
 * Goals with **`frequencyPerWeek`** default to **one** auto block per calendar day
 * (distinct “session days”); set **`maxAutoBlocksPerDay`** to 2+ to allow another
 * auto block the same day when demand and `maxMinutesPerDay` headroom still allow
 * (e.g. morning + afternoon on the same weekday).
 */
export function maxAutoBlocksPerCalendarDay(goal: WeeklyGoal, norm: NormalisedGoalTime): number {
  const explicit = goal.maxAutoBlocksPerDay;
  if (norm.frequencyPerWeek !== undefined) {
    if (explicit !== undefined && explicit >= 1) return Math.min(24, explicit);
    return 1;
  }
  if (explicit !== undefined && explicit >= 1) return Math.min(24, explicit);
  if (minMinutesPerBlockFloor(goal) > 0) return 2;
  return Number.POSITIVE_INFINITY;
}

/** Inherit placement windows (and related knobs) from linked goal groups so Pass 2 caps and Pass 3 gaps match the UI. */
function mergeGoalGroupPlacementSchedulingOntoGoal(plan: WeeklyPlan, goal: WeeklyGoal): WeeklyGoal {
  const ids = goal.groupIds;
  if (!ids?.length) return goal;
  const byId = new Map((plan.goalGroups ?? []).map((g) => [g.id, g] as const));
  const patch: Partial<WeeklyGoal> = {};
  for (const key of GOAL_GROUP_PLACEMENT_MERGE_KEYS) {
    if ((goal as Record<string, unknown>)[key] !== undefined) continue;
    for (const gid of ids) {
      const grp = byId.get(gid);
      if (!grp) continue;
      const gv = (grp as Record<string, unknown>)[key];
      if (gv !== undefined) {
        (patch as Record<string, unknown>)[key] = gv;
        break;
      }
    }
  }
  return Object.keys(patch).length > 0 ? ({ ...goal, ...patch } as WeeklyGoal) : goal;
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

/**
 * Minutes from `allocationNowMs` onward where this goal may receive Pass‑3 auto
 * placement (same pipeline as `placementWindowsForDay` in `allocateGoal`).
 */
const QUANTUM_MS = QUANTUM * MS_PER_MIN;

/**
 * Stable cohort key for invert-calendar rows: intervals snapped to the planner
 * quantum so near-duplicate external intervals (ms drift) still share one future
 * pocket budget.
 */
function invertCalendarAvailabilityCohortKey(
  win: readonly Interval[],
  scheduleInNiceWeather: boolean
): string {
  const snapped = [...win]
    .map((iv) => ({
      startMs: Math.floor(iv.startMs / QUANTUM_MS) * QUANTUM_MS,
      endMs: Math.ceil(iv.endMs / QUANTUM_MS) * QUANTUM_MS
    }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return JSON.stringify(snapped) + "|nw:" + (scheduleInNiceWeather ? "1" : "0");
}

function futurePass3PlaceableMinutesFromNowForGoal(
  goal: WeeklyGoal,
  days: readonly WeekDayBuckets[],
  tz: string,
  availabilityWindows: readonly Interval[] | undefined,
  niceWeatherWindows: readonly Interval[] | undefined,
  allocationNowMs: number
): number {
  const allowedDays =
    goal.daysOfWeek && goal.daysOfWeek.length > 0
      ? goal.daysOfWeek.map((d) => DAY_INDEX[d])
      : goal.dayOfWeek
        ? [DAY_INDEX[goal.dayOfWeek]]
        : [0, 1, 2, 3, 4, 5, 6];
  let sum = 0;
  for (const dayIdx of allowedDays) {
    const day = days[dayIdx];
    if (!day) continue;
    const candidateGaps = placementWindowsForDay(
      day.gaps,
      day.startMs,
      day.endMs,
      availabilityWindows,
      niceWeatherWindows,
      goal,
      tz
    );
    for (const g of candidateGaps) {
      sum += intervalMinutesFromNow(g, allocationNowMs);
    }
  }
  return Math.max(0, Math.floor(sum / QUANTUM) * QUANTUM);
}

/**
 * Longest single contiguous future gap (minutes) this goal could use on one day,
 * using the same windows as Pass 3 but on a gap snapshot before goals consume
 * geometry (`gapsBeforeGoals`).
 */
function maxFuturePlacementGapMinutesAcrossWeek(
  goal: WeeklyGoal,
  days: readonly WeekDayBuckets[],
  gapSnapshot: readonly Interval[][],
  tz: string,
  availabilityWindows: readonly Interval[] | undefined,
  niceWeatherWindows: readonly Interval[] | undefined,
  allocationNowMs: number
): number {
  const allowedDays =
    goal.daysOfWeek && goal.daysOfWeek.length > 0
      ? goal.daysOfWeek.map((d) => DAY_INDEX[d])
      : goal.dayOfWeek
        ? [DAY_INDEX[goal.dayOfWeek]]
        : [0, 1, 2, 3, 4, 5, 6];
  let maxMin = 0;
  for (const dayIdx of allowedDays) {
    const day = days[dayIdx];
    if (!day) continue;
    const snap = gapSnapshot[dayIdx];
    if (!snap) continue;
    const candidateGaps = placementWindowsForDay(
      snap,
      day.startMs,
      day.endMs,
      availabilityWindows,
      niceWeatherWindows,
      goal,
      tz
    );
    for (const g of candidateGaps) {
      maxMin = Math.max(maxMin, intervalMinutesFromNow(g, allocationNowMs));
    }
  }
  return maxMin;
}

/**
 * Upper bound on weekly minutes this goal can ever receive when both
 * `placementIdealClockAfter` and `placementIdealClockBefore` form a valid hard
 * window: sum of `placementWindowsForDay` gap lengths on allowed weekdays (same
 * pipeline as Pass 3, including invert-calendar and nice-weather filters).
 * Returns `undefined` when there is no hard clock window.
 */
export function weeklyHardIdealWindowMaxPlaceableMinutes(
  goal: WeeklyGoal,
  days: readonly { startMs: number; endMs: number; gaps: Interval[] }[],
  tz: string,
  availabilityWindows: readonly Interval[] | undefined,
  niceWeatherWindows: readonly Interval[] | undefined
): number | undefined {
  if (days.length === 0) return undefined;
  if (!dayHardPlacementIdealWindow(goal, days[0]!.startMs, tz)) return undefined;
  const allowedDays =
    goal.daysOfWeek && goal.daysOfWeek.length > 0
      ? goal.daysOfWeek.map((d) => DAY_INDEX[d])
      : goal.dayOfWeek
        ? [DAY_INDEX[goal.dayOfWeek]]
        : [0, 1, 2, 3, 4, 5, 6];
  let sumMin = 0;
  for (const dayIdx of allowedDays) {
    const day = days[dayIdx];
    if (!day) continue;
    const windows = placementWindowsForDay(
      day.gaps,
      day.startMs,
      day.endMs,
      availabilityWindows,
      niceWeatherWindows,
      goal,
      tz
    );
    for (const iv of windows) {
      sumMin += intervalMinutesFull(iv);
    }
  }
  return Math.max(0, Math.floor(sumMin / QUANTUM) * QUANTUM);
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
  sleepIntervals: readonly Interval[] | undefined,
  blocksByDay: AllocatedBlock[][] | undefined,
  dayIdx: number
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
      goal,
      tz
    );
    if (
      !intervalFullyInsideGaps(candidateGaps, startMs, endMs) ||
      !intervalFullyInsideGaps(day.gaps, consumeStart, consumeEnd)
    ) {
      return null;
    }
  }
  consumeFromGaps(day.gaps, consumeStart, consumeEnd);
  const blk: AllocatedBlock = {
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
  };
  blocks.push(blk);
  if (blocksByDay && dayIdx >= 0 && dayIdx < 7) blocksByDay[dayIdx]!.push(blk);
  return durMin;
}

/**
 * Largest subset of `allowedDayIdx` where no two ISO weekdays are adjacent (|d − d′| ≠ 1).
 * Used to decide whether pass‑0 "non-adjacent spread" can ever absorb weekly demand.
 */
export function maxNonAdjacentPlacementDaysOnCalendar(allowedDayIdx: readonly number[]): number {
  const sorted = [...new Set(allowedDayIdx)].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  if (n > 12) return 7;
  let best = 0;
  for (let mask = 0; mask < 1 << n; mask++) {
    const picked: number[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) picked.push(sorted[i]!);
    }
    let ok = true;
    for (let a = 0; a < picked.length && ok; a++) {
      for (let b = a + 1; b < picked.length; b++) {
        if (Math.abs(picked[a]! - picked[b]!) === 1) {
          ok = false;
          break;
        }
      }
    }
    if (ok) best = Math.max(best, picked.length);
  }
  return best;
}

function allocateGoal(
  prepared: PreparedGoal,
  days: { startMs: number; endMs: number; gaps: Interval[] }[],
  blocks: AllocatedBlock[],
  blocksByDay: AllocatedBlock[][],
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
  /** Full Pass‑3 cohort (mutating `effectiveMinutes`) for anti–peer-sandwich gap filtering. */
  pass3PreparedCohort: readonly PreparedGoal[],
  battery?: {
    goalsById: ReadonlyMap<string, WeeklyGoal>;
    dayDrainScores: readonly number[];
    personalSystem: PersonalSystem;
  },
  groupPlacement?: GoalGroupPlacementContext,
  /**
   * When true (stacked goal-window mode), Pass 3 skips greedy auto blocks. Callers pass empty
   * override maps so linear-mode pins are ignored; this flag remains as a guardrail.
   */
  pinsOnlyPlacement?: boolean
): void {
  const { goal, norm } = prepared;
  let remainingMinutes = prepared.effectiveMinutes;
  const pinsOnly = pinsOnlyPlacement ?? false;
  const entryPass3DemandMinutes = remainingMinutes;
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

  const niceWeatherBiasActive =
    niceWeatherWindows !== undefined && niceWeatherWindows.length > 0;
  const orderedPlacementDays =
    niceWeatherBiasActive && allowedDays.length > 1 ? [...allowedDays] : allowedDays;
  if (niceWeatherBiasActive && allowedDays.length > 1 && niceWeatherWindows) {
    const windows = niceWeatherWindows;
    if (goal.scheduleInNiceWeather === true) {
      orderedPlacementDays.sort((ia, ib) => {
        const da = days[ia]!;
        const db = days[ib]!;
        const ma = niceOverlapFutureMinutesForBias(
          da.gaps,
          da.startMs,
          da.endMs,
          windows,
          availabilityWindows,
          nowMs
        );
        const mb = niceOverlapFutureMinutesForBias(
          db.gaps,
          db.startMs,
          db.endMs,
          windows,
          availabilityWindows,
          nowMs
        );
        if (mb !== ma) return mb - ma;
        return ia - ib;
      });
    } else {
      orderedPlacementDays.sort((ia, ib) => {
        const da = days[ia]!;
        const db = days[ib]!;
        const ma = niceOverlapFutureMinutesForBias(
          da.gaps,
          da.startMs,
          da.endMs,
          windows,
          undefined,
          nowMs
        );
        const mb = niceOverlapFutureMinutesForBias(
          db.gaps,
          db.startMs,
          db.endMs,
          windows,
          undefined,
          nowMs
        );
        if (ma !== mb) return ma - mb;
        return ia - ib;
      });
    }
  }

  const hasFuturePlacementWindow = (dayIdx: number): boolean => {
    const day = days[dayIdx]!;
    const candidateGaps = placementWindowsForDay(
      day.gaps,
      day.startMs,
      day.endMs,
      availabilityWindows,
      niceWeatherWindows,
      goal,
      tz
    );
    const futureCandidateGaps =
      nowMs === undefined
        ? candidateGaps
        : candidateGaps
            .map((g) => ({ startMs: Math.max(g.startMs, nowMs), endMs: g.endMs }))
            .filter((g) => g.endMs > g.startMs);
    return futureCandidateGaps.length > 0;
  };

  let placementDaysRemain = 0;
  for (const dayIdx of allowedDays) {
    if (hasFuturePlacementWindow(dayIdx)) placementDaysRemain++;
  }

  // How many days do we want this goal to occupy? frequencyPerWeek wins,
  // else a day-pinned goal stays on its single day, else spread across all 7.
  // When frequency is set, cap by remaining calendar days that still have a
  // placement window (at most one auto block per day).
  const freqSlice =
    norm.frequencyPerWeek === undefined
      ? allowedDays.length
      : Math.min(norm.frequencyPerWeek, placementDaysRemain);

  const maxDaysForQuantum = Math.max(1, Math.floor(remainingMinutes / QUANTUM));
  const targetDays = Math.min(allowedDays.length, freqSlice, maxDaysForQuantum);
  if (targetDays <= 0) return;

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
    const inDay = blocksByDay[dayIdx] ?? [];
    const dayMinutesAlready = inDay
      .filter((b) => b.goalId === goal.id && b.startMs >= day.startMs && b.endMs <= day.endMs)
      .reduce((acc, b) => acc + Math.floor((b.endMs - b.startMs) / MS_PER_MIN), 0);
    const dayLoggedMinutes = loggedGoalBusyMinutesForDay(busy, goal.id, day.startMs, day.endMs);
    return norm.maxMinutesPerDay !== undefined
      ? Math.max(0, norm.maxMinutesPerDay - (dayMinutesAlready + dayLoggedMinutes))
      : Number.POSITIVE_INFINITY;
  };

  const effectiveDayHeadroomFor = (dayIdx: number): number =>
    Math.min(dayHeadroomFor(dayIdx), aggregateGroupDailyHeadroomMinutes(groupPlacement, goal.id, dayIdx));

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

  let pass0NonAdjacentSpreadDeferrals = 0;
  const sliceCapForSpreadRule = Math.min(
    perDayBudget,
    norm.maxMinutesPerDay !== undefined ? norm.maxMinutesPerDay : Number.POSITIVE_INFINITY
  );
  const sliceQuantisedForSpread = Math.max(QUANTUM, Math.floor(sliceCapForSpreadRule / QUANTUM) * QUANTUM);
  const minCalendarDaysAtPass0Slice = Math.ceil(entryPass3DemandMinutes / sliceQuantisedForSpread);
  const maxNonAdjacentPlacementDays = maxNonAdjacentPlacementDaysOnCalendar(allowedDays);
  // Without an explicit daily cap, "needs every second day" is ill-defined for Pass‑3
  // geometry; keep spread available for nice-weather spill tests (uncapped rows).
  const pass0SpreadRequiresAdjacentDays =
    norm.maxMinutesPerDay !== undefined &&
    minCalendarDaysAtPass0Slice > maxNonAdjacentPlacementDays;
  const pass0NonAdjacentSpreadLightDemand =
    entryPass3DemandMinutes <= PASS0_NONADJ_SPREAD_MAX_DEMAND_FOR_RULE_MIN;

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
    for (const dayIdx of orderedPlacementDays) {
      if (remainingMinutes <= 0) break;
      if (norm.frequencyPerWeek !== undefined && pass === 0 && daysScheduledThisPass >= targetDays)
        break;
      const day = days[dayIdx]!;
      const dayGoalBlocks = blocksByDay[dayIdx]!.filter(
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

      const autoBlocksToday = dayGoalBlocks.filter((b) => !b.pinnedFromOverride).length;
      const autoBlockDayCap = maxAutoBlocksPerCalendarDay(goal, norm);
      if (Number.isFinite(autoBlockDayCap) && autoBlocksToday >= autoBlockDayCap) {
        continue;
      }

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
            sleepIntervals,
            blocksByDay,
            dayIdx
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

      if (pinsOnly) continue;

      // Pass 0 establishes an even per-day budget; pass 1+ spill `remainingMinutes`
      // into any day that still has gap + headroom. Skipping days that already have a block prevented spill entirely (large hatched “available” bands
      // stayed empty while weekly targets stayed unfilled).
      if (
        norm.frequencyPerWeek === undefined &&
        dayGoalBlocks.length > 0 &&
        remainingMinutes < QUANTUM
      )
        continue;

      // Pass‑0 "non-adjacent spread" (low priority): defer placing next to an existing
      // same-goal day when a non-adjacent empty day still exists. Capped per week,
      // skipped for heavy demand or when demand cannot fit without consecutive days.
      const occupiedDays = occupiedGoalDayIndexes();
      const eligiblePass0NonAdjacentSpread =
        pass === 0 &&
        !needsExtraPasses &&
        pass0NonAdjacentSpreadLightDemand &&
        !pass0SpreadRequiresAdjacentDays &&
        pass0NonAdjacentSpreadDeferrals < PASS0_NONADJ_SPREAD_MAX_DEFERRALS_PER_WEEK &&
        hasAdjacentGoalDay(dayIdx, occupiedDays) &&
        hasNonAdjacentAlternativeDay(dayIdx, occupiedDays);
      if (eligiblePass0NonAdjacentSpread) {
        pass0NonAdjacentSpreadDeferrals++;
        continue;
      }

      const candidateGaps = placementWindowsForDay(
        day.gaps,
        day.startMs,
        day.endMs,
        availabilityWindows,
        niceWeatherWindows,
        goal,
        tz
      );
      const futureCandidateGaps =
        nowMs === undefined
          ? candidateGaps
          : candidateGaps
              .map((g) => ({ startMs: Math.max(g.startMs, nowMs), endMs: g.endMs }))
              .filter((g) => g.endMs > g.startMs);
      if (futureCandidateGaps.length === 0) continue;
      const dayMaxCandidateMinutes = futureCandidateGaps.reduce(
        (mx, g) => Math.max(mx, intervalMinutesFull(g)),
        0
      );
      // Energy-suggestion pass needs to see only blocks already placed on the
      // current day so adjacency scoring doesn't reach across day boundaries.
      const placedToday = blocksByDay[dayIdx] ?? [];
      const ownNonSegment = dayGoalBlocks.filter((b) => !b.segment);
      const contiguitySlackMs = Math.max(MS_PER_MIN, gymTravelPadMs + MS_PER_MIN);
      const gapPool: readonly Interval[] =
        norm.frequencyPerWeek === undefined
          ? filterGapsAvoidSandwichingPeerWithUnmetDemand(
              futureCandidateGaps,
              placedToday,
              day.endMs,
              goal.id,
              pass3PreparedCohort,
              contiguitySlackMs,
              respectsPeerContinuationPocketsWhenChoosingGaps(goal)
            )
          : futureCandidateGaps;
      const gapsTouchingOwn =
        norm.frequencyPerWeek === undefined && ownNonSegment.length > 0
          ? gapsTouchingOwnDayBlocks(gapPool, ownNonSegment, contiguitySlackMs)
          : [];
      const batteryArg = battery
        ? {
            goalsById: battery.goalsById,
            dayDrainScores: battery.dayDrainScores,
            dayIdx,
            personalSystem: battery.personalSystem
          }
        : undefined;
      const sameDayMultiAutoAllowed = norm.frequencyPerWeek === undefined;
      let slot =
        gapsTouchingOwn.length > 0
          ? pickGapForGoal(
              gapsTouchingOwn,
              goal,
              dayHeadroom,
              energy,
              placement,
              frameworkInclusion,
              tz,
              placedToday,
              gymTravelPadMin,
              batteryArg,
              false
            )
          : null;
      if (!slot) {
        slot = pickGapForGoal(
          gapPool,
          goal,
          dayHeadroom,
          energy,
          placement,
          frameworkInclusion,
          tz,
          placedToday,
          gymTravelPadMin,
          batteryArg,
          sameDayMultiAutoAllowed
        );
      }
      if (!slot) continue;
      if (minPerDay > 0 && slot.minutes < minPerDay && remainingMinutes >= minPerDay) {
        const floorEligibleGaps = gapPool.filter((g) => intervalMinutesFull(g) >= minPerDay);
        if (floorEligibleGaps.length > 0) {
          const floorSlot = pickGapForGoal(
            floorEligibleGaps,
            goal,
            dayHeadroom,
            energy,
            placement,
            frameworkInclusion,
            tz,
            placedToday,
            gymTravelPadMin,
            batteryArg,
            sameDayMultiAutoAllowed
          );
          if (floorSlot && floorSlot.minutes >= minPerDay) {
            slot = floorSlot;
          }
        }
      }
      if (minPerDay > 0 && slot.minutes < minPerDay) {
        // Treat min/day as strict only when this day has enough contiguous space to satisfy it.
        // If no candidate gap can reach the floor, placing a smaller chunk is better than
        // starving weekly demand behind an unreachable per-day threshold.
        if (dayMaxCandidateMinutes >= minPerDay && remainingMinutes >= minPerDay) {
          continue;
        }
      }
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
      const minBlk = minMinutesPerBlockFloor(goal);
      if (minBlk > 0) {
        const slotCap = Math.min(remainingMinutes, dayHeadroom, slot.minutes);
        if (placeMinutes < minBlk && slotCap >= minBlk) {
          placeMinutes = Math.min(slotCap, Math.max(placeMinutes, minBlk));
        }
        if (placeMinutes < minBlk && remainingMinutes >= minBlk) {
          continue;
        }
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
      const autoBlk: AllocatedBlock = {
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
      };
      blocks.push(autoBlk);
      blocksByDay[dayIdx]!.push(autoBlk);
      remainingMinutes -= placedMinutes;
      recordGoalGroupPlacementMinutes(groupPlacement, goal.id, dayIdx, placedMinutes);
      slotIndex++;
      daysScheduledThisPass++;
    }
    if (daysScheduledThisPass === 0) {
      break;
    }
  }
  const nodeEnv =
    (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV ?? "";
  if (
    nodeEnv !== "production" &&
    !pinsOnly &&
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

/**
 * Minutes in `(dayGaps [∩ availability] ∩ niceWeatherWindows)` clipped to calendar day,
 * optionally to the portion after `nowMs`. Used only for weekday iteration biasing —
 * mirrors `placementWindowsForDay`'s layering for nice-weather goals (`availability`),
 * unconstrained contests use gaps ∩ nice directly.
 */
function niceOverlapFutureMinutesForBias(
  dayGaps: readonly Interval[],
  dayStartMs: number,
  dayEndMs: number,
  niceWeatherWindows: readonly Interval[],
  availabilityIntersectFirst: readonly Interval[] | undefined,
  nowMs: number | undefined
): number {
  if (!niceWeatherWindows.length) return 0;
  let g: Interval[] = dayGaps as Interval[];
  if (availabilityIntersectFirst && availabilityIntersectFirst.length > 0) {
    g = intersectWithAvailability(g, availabilityIntersectFirst, dayStartMs, dayEndMs);
    if (g.length === 0) return 0;
  }
  const raw = intersectWithAvailability(g, niceWeatherWindows, dayStartMs, dayEndMs);
  let ms = 0;
  for (const w of raw) {
    const s = nowMs === undefined ? w.startMs : Math.max(w.startMs, nowMs);
    const e = w.endMs;
    if (e > s) ms += e - s;
  }
  return Math.floor(ms / MS_PER_MIN);
}

/** Pass 3 ordering: goals constrained to nice-weather windows run before unconstrained peers. */
function compareGoalsWithNiceWeatherFirst(a: WeeklyGoal, b: WeeklyGoal): number {
  const aNw = a.scheduleInNiceWeather === true ? 0 : 1;
  const bNw = b.scheduleInNiceWeather === true ? 0 : 1;
  return aNw - bNw;
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

/** Ideal clock rows that participate in placement nudges after optional filter. */
function effectivePlacementIdealClockTimes(
  goal: WeeklyGoal
): readonly { hour: number; minute: number }[] | undefined {
  const raw = goal.placementIdealClockTimes;
  if (!raw?.length) return undefined;
  const after = effectivePlacementIdealAfterBoundary(goal);
  const before = effectivePlacementIdealBeforeBoundary(goal);
  let filtered = raw;
  if (after) {
    const boundaryMin = after.hour * 60 + after.minute;
    filtered = filtered.filter((t) => t.hour * 60 + t.minute >= boundaryMin);
  }
  if (before) {
    const boundaryMin = before.hour * 60 + before.minute;
    filtered = filtered.filter((t) => t.hour * 60 + t.minute < boundaryMin);
  }
  return filtered.length > 0 ? filtered : undefined;
}

function scoreGapForPlacementIdeals(
  gap: Interval,
  goal: WeeklyGoal,
  tz: string,
  blockMinutes: number
): number {
  const ideals = effectivePlacementIdealClockTimes(goal);
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
  const raw = -PLACEMENT_IDEAL_CLOCK_WEIGHT * bestDistMin;
  return Math.max(raw, PLACEMENT_IDEAL_CLOCK_SCORE_FLOOR);
}

/**
 * When multiple auto blocks per day are allowed, strongly prefer extending an
 * existing same-goal run wall-to-wall so Pass‑3 round-robin peers cannot slot
 * into a gap between two chunks of the same goal.
 */
const SAME_GOAL_GAP_TOUCH_SCORE_BONUS = 22;

function scoreGapTouchingPlacedSameGoalWall(
  gap: Interval,
  goalId: string,
  placedToday: readonly AllocatedBlock[],
  slackMs: number
): number {
  for (const b of placedToday) {
    if (b.segment || b.goalId !== goalId) continue;
    if (
      Math.abs(gap.startMs - b.endMs) <= slackMs ||
      Math.abs(b.startMs - gap.endMs) <= slackMs
    ) {
      return SAME_GOAL_GAP_TOUCH_SCORE_BONUS;
    }
  }
  return 0;
}

/** Free gaps whose interval is within `slackMs` of an existing same-goal block (accounts for gym drive padding after `consumeFromGaps`). */
function gapsTouchingOwnDayBlocks(
  gaps: readonly Interval[],
  ownBlocks: readonly AllocatedBlock[],
  slackMs: number
): Interval[] {
  if (ownBlocks.length === 0) return [];
  return gaps.filter((g) =>
    ownBlocks.some(
      (b) =>
        !b.segment &&
        (Math.abs(g.startMs - b.endMs) <= slackMs || Math.abs(b.startMs - g.endMs) <= slackMs)
    )
  );
}

function mergeAdjacentSameGoalRunsOnDay(
  pieces: readonly AllocatedBlock[],
  slackMs: number
): { startMs: number; endMs: number }[] {
  if (pieces.length === 0) return [];
  const sorted = [...pieces].sort((a, b) => a.startMs - b.startMs);
  const runs: { startMs: number; endMs: number }[] = [];
  for (const b of sorted) {
    const last = runs[runs.length - 1];
    if (last && b.startMs - last.endMs <= slackMs) {
      last.endMs = Math.max(last.endMs, b.endMs);
    } else runs.push({ startMs: b.startMs, endMs: b.endMs });
  }
  return runs;
}

/**
 * Goals the allocator may move to another gap/day so they do not sit in another
 * cohort member’s continuation pocket when that peer still has Pass‑3 demand
 * (House Work reshuffling around 3dCad, etc.).
 */
function respectsPeerContinuationPocketsWhenChoosingGaps(goal: WeeklyGoal): boolean {
  if (goal.commitmentLevel === "nice_to_have") return true;
  const raw = goal.title.trim().toLowerCase();
  const compact = raw.replace(/\s+/g, "");
  if (compact.includes("housework")) return true;
  return raw.includes("house") && raw.includes("work");
}

/**
 * Remove free gaps that (a) sit strictly between two chunks of another cohort goal
 * with unmet demand, and (b) strict interiors of the pocket after a single run of
 * such a goal when the placer is reshuffle-friendly **or** the peer sets any
 * positive `minMinutesPerBlock` (continuation rows like 3dCad).
 */
function filterGapsAvoidSandwichingPeerWithUnmetDemand(
  gaps: readonly Interval[],
  placedToday: readonly AllocatedBlock[],
  dayEndMs: number,
  selfGoalId: string,
  cohort: readonly PreparedGoal[],
  slackMs: number,
  placerReshuffleFriendly: boolean
): Interval[] {
  if (gaps.length === 0) return [];
  const demandFor = new Map(cohort.map((p) => [p.goal.id, p.effectiveMinutes]));
  const dayBlocks = placedToday.filter((b) => !b.segment);
  const kept: Interval[] = [];
  nextGap: for (const g of gaps) {
    for (const pg of cohort) {
      const peerId = pg.goal.id;
      if (peerId === selfGoalId) continue;
      const rem = demandFor.get(peerId) ?? 0;
      if (rem < QUANTUM) continue;
      const peerPieces = dayBlocks.filter((b) => b.goalId === peerId);
      if (peerPieces.length === 0) continue;
      const merged = mergeAdjacentSameGoalRunsOnDay(peerPieces, slackMs);
      if (merged.length >= 2) {
        for (let i = 0; i < merged.length - 1; i++) {
          const leftEnd = merged[i]!.endMs;
          const rightStart = merged[i + 1]!.startMs;
          if (rightStart - leftEnd < QUANTUM * MS_PER_MIN) continue;
          if (
            g.startMs > leftEnd + slackMs &&
            g.endMs < rightStart - slackMs
          ) {
            continue nextGap;
          }
        }
      } else if (merged.length === 1) {
        const rigidPeer = minMinutesPerBlockFloor(pg.goal) > 0;
        if (!placerReshuffleFriendly && !rigidPeer) continue;
        const b0 = merged[0]!;
        const sortedDay = [...dayBlocks].sort((a, b) => a.startMs - b.startMs);
        let nextStart: number | null = null;
        for (const h of sortedDay) {
          if (h.startMs < b0.endMs - slackMs) continue;
          if (h.goalId === peerId && h.startMs <= b0.endMs + slackMs) continue;
          nextStart = h.startMs;
          break;
        }
        const pocketEnd = nextStart ?? dayEndMs;
        if (pocketEnd - b0.endMs >= QUANTUM * MS_PER_MIN) {
          if (g.startMs > b0.endMs + slackMs && g.endMs < pocketEnd - slackMs) {
            continue nextGap;
          }
        }
      }
    }
    kept.push(g);
  }
  return kept.length > 0 ? kept : [...gaps];
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
  },
  sameDayMultiAutoAllowed = false
): { gap: Interval; minutes: number } | null {
  const contiguitySlackMs = Math.max(MS_PER_MIN, gymTravelPadMin * MS_PER_MIN + MS_PER_MIN);
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
    const contiguityScore = sameDayMultiAutoAllowed
      ? scoreGapTouchingPlacedSameGoalWall(g, goal.id, placedToday, contiguitySlackMs)
      : 0;
    candidates.push({
      gap: g,
      minutes: blockMin,
      score: energyScore + suggestionScore + batteryScore + idealScore + contiguityScore
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.gap.startMs !== b.gap.startMs) return a.gap.startMs - b.gap.startMs;
    return a.gap.endMs - b.gap.endMs;
  });
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
  if (mode === "neutral") {
    // Before noon: favour earlier starts (finish-early) so a 7am pocket is not skipped
    // for a later same-day gap — that left prime mornings for lower RR peers.
    // After noon: keep a mild mid-afternoon peak so workLayer / attention signals can
    // still outrank distant-morning gaps for evening-biased goals (see weekly tests).
    if (startHour < 12) return (12 - startHour) * 0.06;
    return -Math.abs(startHour - 12) * 0.35;
  }
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
 * preempt true equal-share peers for tier ordering. Nice-weather–constrained rows
 * precede unconstrained peers (scarcer windows). **Plan list order** (`index`)
 * breaks ties among peers in the same class; then larger remaining demand last.
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
  const nwCmp = compareGoalsWithNiceWeatherFirst(a.goal, b.goal);
  if (nwCmp !== 0) return nwCmp;
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
/**
 * Far ideal times must not dominate `energyMode` / finish-early morning bias — raw
 * `-PLACEMENT_IDEAL_CLOCK_WEIGHT * distMin` can exceed 40 for a morning gap vs a
 * mid-afternoon ideal, starving prime weekday morning gaps for lower RR peers.
 * Floor stays shallow so `workLayer` / `attentionMode` nudges still win vs AM.
 */
const PLACEMENT_IDEAL_CLOCK_SCORE_FLOOR = -1;

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
  const ideals = effectivePlacementIdealClockTimes(goal);
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
    let bestIdealIdx = ideals.length;
    for (let ii = 0; ii < ideals.length; ii++) {
      const ideal = ideals[ii]!;
      const idealMs = dayMidnight + (ideal.hour * 3600 + ideal.minute * 60) * 1000;
      /** Align block start to ideal local clock (user-facing "ideal time"), not block midpoint. */
      const wantStart = idealMs;
      const clamped = Math.max(inner.startMs, Math.min(wantStart, inner.endMs - fitMs));
      const dist = Math.abs(clamped - idealMs);
      if (dist < bestDist || (dist === bestDist && ii < bestIdealIdx)) {
        bestDist = dist;
        bestIdealIdx = ii;
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
  const allocatorRemainderHintByGoalId: Record<string, number> = {};
  for (const p of prepared) {
    allocatorRemainderHintByGoalId[p.goal.id] = Math.max(
      0,
      p.plannedWeeklyMinutes - p.pass1EndEffectiveMinutes
    );
  }
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
      demandMinutesBeforePass3: placementDemand,
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
    allocatorRemainderHintByGoalId,
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
