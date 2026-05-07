"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AllocatedBlock, BusyEvent, WeekMetrics } from "@calendar-automations/planner";
import {
  FRAMEWORK_REGISTRY_DEFAULT_LABELS,
  type AllocatorGoalWindowMode,
  type FrameworkRegistryId,
  type FrameworkSystem,
  type GoalGroup,
  type WeeklyGoal
} from "@calendar-automations/schema";
import type { FrameworkOverlayLayerState } from "@/lib/framework-calendar-overlay-tags";
import type { SystemBlock } from "@/lib/week-blocks";
import { useDebouncedIdleRouterRefresh } from "@/hooks/useDebouncedIdleRouterRefresh";
import { goalColorFromKey } from "@/lib/goal-colors";
import { compareRibbonLaneKeysPriority } from "@/lib/ribbon-lane-order";
import { WEEK_MS } from "@/lib/effective-schedule-horizon";
import { WeekCalendar } from "../week-calendar";
import { usePlanCalendarView } from "./plan-calendar-view-context";
import type { GoalGroupRailBundle } from "./perfect-week-stats-types";
import { clearAllUserDragGoalOverrides } from "./actions";
import { formatMinutes, goalGroupAggregateSummaryLine } from "./goal-helpers";

const WEATHER_STORAGE_KEY = "dashboard.plan.calendar.showWeather";
const INVERTED_TIMEMAP_STORAGE_KEY = "dashboard.plan.calendar.invertedTimemapVisibility";

const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function formatGoalGroupGapLine(
  gap: WeekMetrics["goalGroupGaps"][number],
  groupTitle: string
): string {
  const m = formatMinutes(Math.max(0, Math.round(gap.shortMinutes)));
  switch (gap.reason) {
    case "weeklyCap":
      return `${groupTitle}: cohort weekly cap leaves ~${m} unmet across members (after floors).`;
    case "weeklyFloor":
      return `${groupTitle}: cohort weekly floor short ~${m}.`;
    case "dailyCap": {
      const day =
        gap.dayIndex !== undefined && gap.dayIndex >= 0 && gap.dayIndex < 7
          ? DOW_SHORT[gap.dayIndex]
          : "one day";
      return `${groupTitle}: on ${day}, cohort combined time exceeds the daily cap by ~${m}.`;
    }
  }
}

function loadInvertedVisibilityMap(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(INVERTED_TIMEMAP_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
}

function isInvertedGoalShown(
  map: Record<string, boolean>,
  goalId: string,
  defaultWhenUnset: boolean = false
): boolean {
  const stored = map[goalId];
  return stored === undefined ? defaultWhenUnset : stored === true;
}

function applyProposedOptimisticTimes(
  blocks: readonly AllocatedBlock[],
  patch: Record<string, { startMs: number; endMs: number }>
): AllocatedBlock[] {
  if (Object.keys(patch).length === 0) return [...blocks];
  return blocks.map((b) => {
    if (!b.dragKey) return b;
    const p = patch[b.dragKey];
    if (!p) return b;
    return {
      ...b,
      startMs: p.startMs,
      endMs: p.endMs,
      dragOverrideSaved: true,
      pinnedFromOverride: true,
      overrideSource: "drag" as const
    };
  });
}

function partsInTimezone(ms: number, timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  });
  const parts = fmt.formatToParts(new Date(ms)).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday ?? ""
  };
}

function todayOffsetFromWeekStart(weekStartMs: number, timezone: string): number {
  const from = partsInTimezone(weekStartMs, timezone);
  const to = partsInTimezone(Date.now(), timezone);
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

export function RangeToggleCalendar({
  weekStartMs,
  calendarWeekStartsMs,
  previewWeekLabels,
  timezone,
  busy,
  daySheetGoalBusy = [],
  system,
  proposed,
  compact,
  schedulingGoals,
  ribbonLaneOrderingGoals,
  frameworkSystem,
  wheelAreas,
  goalGroups = [],
  goalGroupGaps = [],
  goalGroupMinutes = {},
  goalGroupBundles,
  fallbackGoalGroupGaps = [],
  fallbackGoalGroupMinutes = {},
  hasUserDragGoalOverrides = false,
  stackedTimemapRibbonsAboveProposedGoals = false,
  allocatorGoalWindowMode
}: {
  weekStartMs: number;
  calendarWeekStartsMs?: readonly number[];
  previewWeekLabels?: readonly string[];
  timezone: string;
  busy: readonly BusyEvent[];
  daySheetGoalBusy?: readonly BusyEvent[];
  system: readonly SystemBlock[];
  proposed: readonly AllocatedBlock[];
  compact?: boolean;
  schedulingGoals?: readonly WeeklyGoal[];
  /** Plan hub order for timemap ribbons/toggles (incl. gym row position); defaults to schedulingGoals. */
  ribbonLaneOrderingGoals?: readonly WeeklyGoal[];
  frameworkSystem?: FrameworkSystem;
  wheelAreas?: ReadonlyArray<{ id: string; label: string }>;
  goalGroups?: readonly GoalGroup[];
  goalGroupGaps?: ReadonlyArray<WeekMetrics["goalGroupGaps"][number]>;
  goalGroupMinutes?: Readonly<Record<string, number>>;
  goalGroupBundles?: readonly GoalGroupRailBundle[];
  fallbackGoalGroupGaps?: ReadonlyArray<WeekMetrics["goalGroupGaps"][number]>;
  fallbackGoalGroupMinutes?: Readonly<Record<string, number>>;
  /** Server: plan has at least one `goal` override with `source: "drag"`. */
  hasUserDragGoalOverrides?: boolean;
  /** Hybrid weeks with no linear “block time maps”: draw stacked/invert ribbons above proposed blocks. */
  stackedTimemapRibbonsAboveProposedGoals?: boolean;
  /** Drives per–linear-goal z-order when hybrid has mixed Yes/No timemap blocking. */
  allocatorGoalWindowMode?: AllocatorGoalWindowMode;
}) {
  const router = useRouter();
  const scheduleStaleDataRefresh = useDebouncedIdleRouterRefresh(750);
  const {
    rangeMode,
    setRangeMode,
    previewWeekIdx,
    setPreviewWeekIdx,
    rollingStatsMode,
    setRollingStatsMode
  } = usePlanCalendarView();
  const [timePatch, setTimePatch] = useState<Record<string, { startMs: number; endMs: number }>>({});
  const [showWeather, setShowWeather] = useState(true);
  const [invertedVisibility, setInvertedVisibility] = useState<Record<string, boolean>>({});
  const [clearAllDragPending, setClearAllDragPending] = useState(false);

  const weekStarts =
    calendarWeekStartsMs && calendarWeekStartsMs.length > 0 ? calendarWeekStartsMs : [weekStartMs];

  const safeWeekIdx = Math.min(previewWeekIdx, Math.max(0, weekStarts.length - 1));
  const anchorWeekStartMs = weekStarts[safeWeekIdx]!;

  const useRollingStrip = rangeMode === "next-7-days";
  const calendarAnchorMs = useRollingStrip ? weekStartMs : anchorWeekStartMs;
  const calendarAnchorEndMs = calendarAnchorMs + WEEK_MS;

  function clipToCalendarAnchor<T extends { startMs: number; endMs: number }>(xs: readonly T[]): T[] {
    return xs.filter((x) => x.startMs < calendarAnchorEndMs && x.endMs > calendarAnchorMs);
  }

  const busyShown = useMemo(
    () => (useRollingStrip ? [...busy] : clipToCalendarAnchor(busy)),
    [busy, useRollingStrip, calendarAnchorMs, calendarAnchorEndMs]
  );
  const daySheetShown = useMemo(
    () => (useRollingStrip ? [...daySheetGoalBusy] : clipToCalendarAnchor(daySheetGoalBusy)),
    [daySheetGoalBusy, useRollingStrip, calendarAnchorMs, calendarAnchorEndMs]
  );
  const systemShown = useMemo(
    () => (useRollingStrip ? [...system] : clipToCalendarAnchor(system)),
    [system, useRollingStrip, calendarAnchorMs, calendarAnchorEndMs]
  );
  const proposedShown = useMemo(
    () => (useRollingStrip ? [...proposed] : clipToCalendarAnchor(proposed)),
    [proposed, useRollingStrip, calendarAnchorMs, calendarAnchorEndMs]
  );

  const taggableFrameworkRows = useMemo(
    () =>
      (frameworkSystem?.frameworks ?? [])
        .filter((f) => f.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
    [frameworkSystem?.frameworks]
  );

  const fwOverlayBootstrapSig = useMemo(
    () =>
      taggableFrameworkRows.map((r) => `${r.id}:${r.overlay.enabled}`).join("|"),
    [taggableFrameworkRows]
  );

  const [fwOverlayLayers, setFwOverlayLayers] = useState<FrameworkOverlayLayerState>({});

  useEffect(() => {
    const init: FrameworkOverlayLayerState = {};
    for (const row of taggableFrameworkRows) {
      init[row.id] = row.overlay.enabled !== false;
    }
    setFwOverlayLayers(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap overlay toggles when profile changes
  }, [fwOverlayBootstrapSig]);

  const wheelAreaLabel = useMemo(() => {
    const m = new Map((wheelAreas ?? []).map((a) => [a.id, a.label] as const));
    return (id: string) => m.get(id) ?? id;
  }, [wheelAreas]);

  const proposedSig = useMemo(
    () =>
      proposed
        .filter((b) => b.dragKey)
        .map((b) => `${b.dragKey}:${b.startMs}:${b.endMs}`)
        .sort()
        .join("|"),
    [proposed]
  );

  useEffect(() => {
    setTimePatch((p) => (Object.keys(p).length === 0 ? p : {}));
  }, [proposedSig]);

  const displayProposed = useMemo(
    () => applyProposedOptimisticTimes(proposedShown, timePatch),
    [proposedShown, timePatch]
  );

  const handleProposedDragCommit = (updates: Record<string, { startMs: number; endMs: number }>) => {
    setTimePatch((prev) => ({ ...prev, ...updates }));
    scheduleStaleDataRefresh();
  };

  const handleProposedDragOverridesCleared = (dragKeys: string[]) => {
    setTimePatch((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const next = { ...prev };
      for (const k of dragKeys) delete next[k];
      return next;
    });
    scheduleStaleDataRefresh();
  };

  async function handleClearAllCustomMoves() {
    if (!hasUserDragGoalOverrides) return;
    setClearAllDragPending(true);
    try {
      await clearAllUserDragGoalOverrides();
      setTimePatch({});
      scheduleStaleDataRefresh();
      router.refresh();
    } catch (err) {
      console.warn("clearAllUserDragGoalOverrides failed", err);
    } finally {
      setClearAllDragPending(false);
    }
  }

  useEffect(() => {
    try {
      const weatherStored = window.localStorage.getItem(WEATHER_STORAGE_KEY);
      if (weatherStored === "false") setShowWeather(false);
      setInvertedVisibility(loadInvertedVisibilityMap());
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const dayOffsets = useMemo(() => {
    if (rangeMode === "calendar-week") return [0, 1, 2, 3, 4, 5, 6];
    const startOffset = todayOffsetFromWeekStart(weekStartMs, timezone);
    return Array.from({ length: 7 }, (_, i) => startOffset + i);
  }, [rangeMode, timezone, weekStartMs]);

  const effectiveRailBundles: GoalGroupRailBundle[] = useMemo(() => {
    if (goalGroupBundles && goalGroupBundles.length > 0) return [...goalGroupBundles];
    return [
      {
        gaps: [...(fallbackGoalGroupGaps.length > 0 ? fallbackGoalGroupGaps : goalGroupGaps)],
        minutes: {
          ...(Object.keys(fallbackGoalGroupMinutes).length > 0
            ? fallbackGoalGroupMinutes
            : goalGroupMinutes)
        }
      }
    ];
  }, [
    fallbackGoalGroupGaps,
    fallbackGoalGroupMinutes,
    goalGroupBundles,
    goalGroupGaps,
    goalGroupMinutes
  ]);

  const setWeatherAndPersist = (next: boolean) => {
    setShowWeather(next);
    try {
      window.localStorage.setItem(WEATHER_STORAGE_KEY, String(next));
    } catch {
      // Ignore storage failures.
    }
  };

  const invertedGoals = useMemo(() => {
    const seen = new Map<string, { title: string; kind: "inverted" | "stacked" }>();
    for (const s of system) {
      const goalId =
        s.system === "inverted-timemap"
          ? s.invertedGoalId
          : s.system === "stacked-timemap"
            ? s.stackedGoalId
            : undefined;
      if (!goalId) continue;
      if (!seen.has(goalId)) {
        seen.set(goalId, {
          title: s.title,
          kind: s.system === "stacked-timemap" ? "stacked" : "inverted"
        });
      }
    }
    return [...seen.entries()]
      .map(([goalId, entry]) => ({ goalId, title: entry.title, kind: entry.kind }))
      .sort((a, b) =>
        compareRibbonLaneKeysPriority(`inv:${a.goalId}`, `inv:${b.goalId}`, ribbonLaneOrderingGoals ?? schedulingGoals)
      );
  }, [system, schedulingGoals, ribbonLaneOrderingGoals]);

  const setInvertedGoalAndPersist = (goalId: string, next: boolean) => {
    setInvertedVisibility((prev) => {
      const merged = { ...prev, [goalId]: next };
      try {
        window.localStorage.setItem(INVERTED_TIMEMAP_STORAGE_KEY, JSON.stringify(merged));
      } catch {
        // Ignore storage failures.
      }
      return merged;
    });
  };

  const visibleSystem = useMemo(
    () =>
      systemShown.filter((s) => {
        if (s.system === "weather" && !showWeather) return false;
        if (
          (s.system === "inverted-timemap" && s.invertedGoalId) ||
          (s.system === "stacked-timemap" && s.stackedGoalId)
        ) {
          const gid = s.system === "inverted-timemap" ? s.invertedGoalId! : s.stackedGoalId!;
          const defaultOn = s.system === "stacked-timemap" && allocatorGoalWindowMode === "stacked";
          return isInvertedGoalShown(invertedVisibility, gid, defaultOn);
        }
        return true;
      }),
    [showWeather, invertedVisibility, systemShown, allocatorGoalWindowMode]
  );
  useEffect(() => {
    // #region agent log
    fetch("http://127.0.0.1:7257/ingest/a9e25fe2-a3a6-41a5-b2f2-fc188fac1d73", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "126be4" }, body: JSON.stringify({ sessionId: "126be4", runId: "allocator-output-debug-post-fix", hypothesisId: "H7", location: "apps/web/src/app/dashboard/plan/range-toggle-calendar.tsx:stackedDefault", message: "stacked ribbon default visibility snapshot", data: { allocatorGoalWindowMode, stackedRibbonCount: systemShown.filter((s) => s.system === "stacked-timemap").length, visibleStackedRibbonCount: visibleSystem.filter((s) => s.system === "stacked-timemap").length, invertedToggleKeys: Object.keys(invertedVisibility).length }, timestamp: Date.now() }) }).catch(() => {});
    // #endregion
  }, [allocatorGoalWindowMode, invertedVisibility, systemShown, visibleSystem]);

  const rollingSpansTwoIsoWeeks = useMemo(
    () => rangeMode === "next-7-days" && dayOffsets.some((d) => d > 6),
    [rangeMode, dayOffsets]
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="px-1 text-xs text-ink-400">
        Existing events sit behind sleep, travel, and your proposed goal blocks. Thin coloured bars:
        invert-calendar availability and — in stacked placement mode — feasible windows per goal (same
        show/hide toggles).
      </div>
      <div className="flex flex-wrap items-center gap-1 px-1 text-xs">
        <button
          type="button"
          onClick={() => setRangeMode("calendar-week")}
          aria-pressed={rangeMode === "calendar-week"}
          className={`rounded border px-2 py-1 ${
            rangeMode === "calendar-week"
              ? "border-accent bg-accent text-accent-fg"
              : "border-ink-200 text-ink-500 hover:bg-ink-50 dark:border-ink-600 dark:text-ink-200 dark:hover:bg-ink-700/30"
          }`}
        >
          Calendar week
        </button>
        <button
          type="button"
          onClick={() => setRangeMode("next-7-days")}
          aria-pressed={rangeMode === "next-7-days"}
          className={`rounded border px-2 py-1 ${
            rangeMode === "next-7-days"
              ? "border-accent bg-accent text-accent-fg"
              : "border-ink-200 text-ink-500 hover:bg-ink-50 dark:border-ink-600 dark:text-ink-200 dark:hover:bg-ink-700/30"
          }`}
        >
          Next 7 days
        </button>
      </div>
      {rangeMode === "next-7-days" ? (
        <div className="flex flex-wrap items-center gap-1 px-1 text-[11px]">
          <span className="shrink-0 text-ink-500 dark:text-ink-400">Stats for this preview:</span>
          <button
            type="button"
            onClick={() => setRollingStatsMode("split")}
            aria-pressed={rollingStatsMode === "split"}
            disabled={!rollingSpansTwoIsoWeeks}
            title={
              rollingSpansTwoIsoWeeks
                ? "Shows two ISO week tallies side by side"
                : "Only one ISO week is visible in this 7-day strip"
            }
            className={`rounded border px-2 py-0.5 ${
              rollingStatsMode === "split"
                ? "border-accent bg-accent text-accent-fg"
                : "border-ink-200 text-ink-600 hover:bg-ink-50 dark:border-ink-600 dark:text-ink-200 dark:hover:bg-ink-700/30"
            } ${
              !rollingSpansTwoIsoWeeks
                ? "cursor-not-allowed opacity-40 hover:bg-transparent dark:hover:bg-transparent"
                : ""
            }`}
          >
            Split ISO weeks
          </button>
          <button
            type="button"
            onClick={() => setRollingStatsMode("combined")}
            aria-pressed={rollingStatsMode === "combined"}
            className={`rounded border px-2 py-0.5 ${
              rollingStatsMode === "combined"
                ? "border-accent bg-accent text-accent-fg"
                : "border-ink-200 text-ink-600 hover:bg-ink-50 dark:border-ink-600 dark:text-ink-200 dark:hover:bg-ink-700/30"
            }`}
          >
            Combined 7-day window
          </button>
        </div>
      ) : null}
      {weekStarts.length > 1 && rangeMode === "calendar-week" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
          <button
            type="button"
            disabled={safeWeekIdx <= 0}
            onClick={() => setPreviewWeekIdx((i) => Math.max(0, i - 1))}
            className={`rounded border px-2 py-1 ${
              safeWeekIdx <= 0
                ? "cursor-not-allowed border-ink-200 opacity-40 dark:border-ink-600"
                : "border-ink-200 text-ink-500 hover:bg-ink-50 dark:border-ink-600 dark:text-ink-200 dark:hover:bg-ink-700/30"
            }`}
          >
            Previous week
          </button>
          <span className="min-w-0 flex-1 text-center text-[11px] text-ink-600 dark:text-ink-300">
            {previewWeekLabels?.[safeWeekIdx] ?? `Week ${safeWeekIdx + 1}`}
          </span>
          <button
            type="button"
            disabled={safeWeekIdx >= weekStarts.length - 1}
            onClick={() => setPreviewWeekIdx((i) => Math.min(weekStarts.length - 1, i + 1))}
            className={`rounded border px-2 py-1 ${
              safeWeekIdx >= weekStarts.length - 1
                ? "cursor-not-allowed border-ink-200 opacity-40 dark:border-ink-600"
                : "border-ink-200 text-ink-500 hover:bg-ink-50 dark:border-ink-600 dark:text-ink-200 dark:hover:bg-ink-700/30"
            }`}
          >
            Next week
          </button>
        </div>
      ) : null}
      {rollingSpansTwoIsoWeeks ? (
        <p className="px-1 text-[11px] leading-snug text-ink-500 dark:text-ink-400">
          This rolling view can show two ISO weeks at once. Each week is still planned as a full
          Mon–Sun: goals may sit on days that are off-screen here. Switch to{" "}
          <span className="font-medium text-ink-700 dark:text-ink-200">Calendar week</span> to see
          the whole board for one week.
        </p>
      ) : null}
      <WeekCalendar
        weekStartMs={calendarAnchorMs}
        timezone={timezone}
        busy={busyShown}
        daySheetGoalBusy={daySheetShown}
        system={visibleSystem}
        proposed={displayProposed}
        compact={compact}
        dayIndices={dayOffsets}
        onProposedDragCommit={handleProposedDragCommit}
        onProposedDragOverridesCleared={handleProposedDragOverridesCleared}
        weeklyGoalsForFrameworkOverlays={schedulingGoals}
        ribbonLaneOrderingGoals={ribbonLaneOrderingGoals}
        frameworkRegistryForOverlays={taggableFrameworkRows}
        frameworkOverlayLayerState={
          taggableFrameworkRows.length && schedulingGoals?.length ? fwOverlayLayers : undefined
        }
        wheelAreaLabel={wheelAreas?.length ? wheelAreaLabel : undefined}
        stackedTimemapRibbonsAboveProposedGoals={stackedTimemapRibbonsAboveProposedGoals}
        allocatorGoalWindowMode={allocatorGoalWindowMode}
      />
      <div className="px-1">
        <button
          type="button"
          disabled={!hasUserDragGoalOverrides || clearAllDragPending}
          onClick={() => void handleClearAllCustomMoves()}
          className={`mt-1 w-full rounded border px-2 py-1.5 text-left text-xs ${
            hasUserDragGoalOverrides && !clearAllDragPending
              ? "border-ink-200 text-ink-700 hover:bg-ink-50 dark:border-ink-600 dark:text-ink-200 dark:hover:bg-ink-700/30"
              : "cursor-not-allowed border-ink-200 text-ink-400 opacity-60 dark:border-ink-600 dark:text-ink-500"
          }`}
        >
          {clearAllDragPending ? "Clearing…" : "Clear all custom moves"}
        </button>
        <p className="mt-1 text-[10px] leading-snug text-ink-500 dark:text-ink-400">
          Removes every goal block you repositioned by dragging. Day-sheet pins are unchanged.
        </p>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1 px-1 text-xs">
        <button
          type="button"
          onClick={() => setWeatherAndPersist(!showWeather)}
          aria-pressed={showWeather}
          className={`rounded border px-2 py-1 ${
            showWeather
              ? "border-sky-400/70 bg-sky-500/20 text-sky-700 dark:text-sky-200"
              : "border-ink-200 text-ink-500 hover:bg-ink-50 dark:border-ink-600 dark:text-ink-200 dark:hover:bg-ink-700/30"
          }`}
        >
          {showWeather ? "Hide weather" : "Show weather"}
        </button>
        {invertedGoals.map(({ goalId, title, kind }) => {
          const defaultOn = kind === "stacked" && allocatorGoalWindowMode === "stacked";
          const on = isInvertedGoalShown(invertedVisibility, goalId, defaultOn);
          const swatch = goalColorFromKey(goalId);
          const short = title.length > 22 ? `${title.slice(0, 20).trimEnd()}…` : title;
          return (
            <button
              key={goalId}
              type="button"
              onClick={() => setInvertedGoalAndPersist(goalId, !on)}
              aria-pressed={on}
              title={title}
              className={`max-w-[11rem] truncate rounded border px-2 py-1 ${
                on
                  ? "border-ink-300 bg-ink-50 text-ink-800 dark:border-ink-500 dark:bg-ink-800/40 dark:text-ink-100"
                  : "border-ink-200 text-ink-500 hover:bg-ink-50 dark:border-ink-600 dark:text-ink-200 dark:hover:bg-ink-700/30"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-3 w-1.5 shrink-0 rounded-sm border border-ink-300/60 dark:border-ink-500/60"
                  style={{ backgroundColor: swatch, opacity: on ? 1 : 0.35 }}
                />
                <span className="truncate">{on ? `Hide ${short}` : `Show ${short}`}</span>
              </span>
            </button>
          );
        })}
      </div>
      {effectiveRailBundles.map((bundle, bi) =>
        bundle.gaps.length > 0 ? (
          <div
            key={`gg-pressure-${bi}`}
            className="mx-1 mt-2 rounded-md border border-amber-300/50 bg-amber-500/10 px-2 py-2 text-[11px] text-amber-950 dark:border-amber-700/40 dark:bg-amber-500/15 dark:text-amber-100"
            role="status"
          >
            <div className="font-semibold">
              Goal-group pressure
              {bundle.weekLabel && effectiveRailBundles.length > 1 ? (
                <span className="font-normal text-amber-900/90 dark:text-amber-50/90">
                  {" "}
                  · {bundle.weekLabel}
                </span>
              ) : null}
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {bundle.gaps.map((gap, i) => {
                const title =
                  goalGroups.find((g) => g.id === gap.groupId)?.title ?? gap.groupId.slice(0, 8);
                return (
                  <li key={`${bi}-${gap.groupId}-${gap.reason}-${String(gap.dayIndex ?? "w")}-${i}`}>
                    {formatGoalGroupGapLine(gap, title)}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null
      )}
      {goalGroups.length > 0 && schedulingGoals?.length
        ? effectiveRailBundles.map((bundle, bi) => (
            <details key={`gg-detail-${bi}`} className="mt-2 px-1 text-xs">
              <summary className="cursor-pointer font-medium text-ink-600 dark:text-ink-300">
                Goal groups
                {bundle.weekLabel && effectiveRailBundles.length > 1 ? (
                  <span className="font-normal text-ink-500"> · {bundle.weekLabel}</span>
                ) : null}
              </summary>
              <ul className="mt-2 flex flex-col gap-2">
                {goalGroups.map((grp) => {
                  const members = (schedulingGoals ?? []).filter((g) => g.groupIds?.includes(grp.id));
                  const line = goalGroupAggregateSummaryLine(grp);
                  const totalMin = bundle.minutes[grp.id];
                  return (
                    <li
                      key={grp.id}
                      className="rounded-md border border-ink-200/80 p-2 dark:border-ink-600"
                    >
                      <div className="font-medium text-ink-800 dark:text-ink-100">{grp.title}</div>
                      {line ? (
                        <div className="mt-0.5 text-[11px] leading-snug text-ink-600 dark:text-ink-300">
                          {line}
                        </div>
                      ) : null}
                      {totalMin !== undefined && totalMin > 0 ? (
                        <div className="mt-0.5 text-[11px] tabular-nums text-ink-500 dark:text-ink-400">
                          Achieved this week (sum of members): {formatMinutes(Math.round(totalMin))}
                        </div>
                      ) : null}
                      {members.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {members.map((g) => {
                            const short =
                              g.title.length > 22 ? `${g.title.slice(0, 20).trimEnd()}…` : g.title;
                            return (
                              <span
                                key={g.id}
                                className="inline-flex max-w-[11rem] items-center gap-1 truncate rounded border border-ink-200 px-1.5 py-0.5 text-[10px] dark:border-ink-600"
                              >
                                <span
                                  aria-hidden
                                  className="h-2 w-2 shrink-0 rounded-sm border border-ink-300/60 dark:border-ink-500/60"
                                  style={{ backgroundColor: goalColorFromKey(g.id) }}
                                />
                                <span className="truncate">{short}</span>
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mt-1 text-[11px] text-ink-400 dark:text-ink-500">
                          No member goals in this planner list.
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          ))
        : null}
      {taggableFrameworkRows.length > 0 && schedulingGoals?.length ? (
        <div className="flex flex-wrap items-center gap-1 px-1 text-xs">
          {taggableFrameworkRows.map((row) => {
            const defaultOn = row.overlay.enabled !== false;
            const layerOn = fwOverlayLayers[row.id] ?? defaultOn;
            const label = FRAMEWORK_REGISTRY_DEFAULT_LABELS[row.id as FrameworkRegistryId] ?? row.id;
            const shortLabel = label.length > 14 ? `${label.slice(0, 12)}…` : label;
            return (
              <button
                key={row.id}
                type="button"
                onClick={() =>
                  setFwOverlayLayers((prev) => ({
                    ...prev,
                    [row.id]: !layerOn
                  }))
                }
                aria-pressed={layerOn}
                title={`Framework tags on calendar: ${label}`}
                className={`rounded border px-2 py-1 ${
                  layerOn
                    ? "border-violet-400/70 bg-violet-500/15 text-violet-900 dark:text-violet-100"
                    : "border-ink-200 text-ink-500 hover:bg-ink-50 dark:border-ink-600 dark:text-ink-200 dark:hover:bg-ink-700/30"
                }`}
              >
                {layerOn ? "Hide" : "Show"} {shortLabel}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
