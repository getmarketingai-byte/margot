"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AllocatedBlock, BusyEvent } from "@calendar-automations/planner";
import type { SystemBlock } from "@/lib/week-blocks";
import { goalColorFromKey } from "@/lib/goal-colors";
import { WeekCalendar } from "../week-calendar";

type CalendarRangeMode = "calendar-week" | "next-7-days";

const STORAGE_KEY = "dashboard.plan.calendar.rangeMode";
const WEATHER_STORAGE_KEY = "dashboard.plan.calendar.showWeather";
const INVERTED_TIMEMAP_STORAGE_KEY = "dashboard.plan.calendar.invertedTimemapVisibility";

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

function isInvertedGoalShown(map: Record<string, boolean>, goalId: string): boolean {
  return map[goalId] === true;
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
  timezone,
  busy,
  daySheetGoalBusy = [],
  system,
  proposed,
  compact
}: {
  weekStartMs: number;
  timezone: string;
  busy: readonly BusyEvent[];
  daySheetGoalBusy?: readonly BusyEvent[];
  system: readonly SystemBlock[];
  proposed: readonly AllocatedBlock[];
  compact?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [timePatch, setTimePatch] = useState<Record<string, { startMs: number; endMs: number }>>({});
  const [mode, setMode] = useState<CalendarRangeMode>("calendar-week");
  const [showWeather, setShowWeather] = useState(true);
  const [invertedVisibility, setInvertedVisibility] = useState<Record<string, boolean>>({});

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
    () => applyProposedOptimisticTimes(proposed, timePatch),
    [proposed, timePatch]
  );

  const handleProposedDragCommit = (updates: Record<string, { startMs: number; endMs: number }>) => {
    setTimePatch((prev) => ({ ...prev, ...updates }));
    startTransition(() => {
      router.refresh();
    });
  };

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "calendar-week" || stored === "next-7-days") {
        setMode(stored);
      }
      const weatherStored = window.localStorage.getItem(WEATHER_STORAGE_KEY);
      if (weatherStored === "false") setShowWeather(false);
      setInvertedVisibility(loadInvertedVisibilityMap());
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const dayOffsets = useMemo(() => {
    if (mode === "calendar-week") return [0, 1, 2, 3, 4, 5, 6];
    const startOffset = todayOffsetFromWeekStart(weekStartMs, timezone);
    return Array.from({ length: 7 }, (_, i) => startOffset + i);
  }, [mode, timezone, weekStartMs]);

  const setAndPersist = (next: CalendarRangeMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage failures.
    }
  };

  const setWeatherAndPersist = (next: boolean) => {
    setShowWeather(next);
    try {
      window.localStorage.setItem(WEATHER_STORAGE_KEY, String(next));
    } catch {
      // Ignore storage failures.
    }
  };

  const invertedGoals = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of system) {
      if (s.system !== "inverted-timemap" || !s.invertedGoalId) continue;
      if (!seen.has(s.invertedGoalId)) seen.set(s.invertedGoalId, s.title);
    }
    return [...seen.entries()]
      .map(([goalId, title]) => ({ goalId, title }))
      .sort((a, b) => a.goalId.localeCompare(b.goalId));
  }, [system]);

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
      system.filter((s) => {
        if (s.system === "weather" && !showWeather) return false;
        if (s.system === "inverted-timemap" && s.invertedGoalId) {
          return isInvertedGoalShown(invertedVisibility, s.invertedGoalId);
        }
        return true;
      }),
    [showWeather, invertedVisibility, system]
  );

  const rollingSpansTwoIsoWeeks = useMemo(
    () => mode === "next-7-days" && dayOffsets.some((d) => d > 6),
    [mode, dayOffsets]
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="px-1 text-xs text-ink-400">
        Existing events sit behind sleep, travel, and your proposed goal blocks.
      </div>
      <div className="flex flex-wrap items-center gap-1 px-1 text-xs">
        <button
          type="button"
          onClick={() => setAndPersist("calendar-week")}
          aria-pressed={mode === "calendar-week"}
          className={`rounded border px-2 py-1 ${
            mode === "calendar-week"
              ? "border-accent bg-accent text-accent-fg"
              : "border-ink-200 text-ink-500 hover:bg-ink-50 dark:border-ink-600 dark:text-ink-200 dark:hover:bg-ink-700/30"
          }`}
        >
          Calendar week
        </button>
        <button
          type="button"
          onClick={() => setAndPersist("next-7-days")}
          aria-pressed={mode === "next-7-days"}
          className={`rounded border px-2 py-1 ${
            mode === "next-7-days"
              ? "border-accent bg-accent text-accent-fg"
              : "border-ink-200 text-ink-500 hover:bg-ink-50 dark:border-ink-600 dark:text-ink-200 dark:hover:bg-ink-700/30"
          }`}
        >
          Next 7 days
        </button>
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
        {invertedGoals.map(({ goalId, title }) => {
          const on = isInvertedGoalShown(invertedVisibility, goalId);
          const swatch = goalColorFromKey(goalId);
          const short =
            title.length > 22 ? `${title.slice(0, 20).trimEnd()}…` : title;
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
      {rollingSpansTwoIsoWeeks ? (
        <p className="px-1 text-[11px] leading-snug text-ink-500 dark:text-ink-400">
          This rolling view can show two ISO weeks at once. Each week is still planned as a full
          Mon–Sun: goals may sit on days that are off-screen here. Switch to{" "}
          <span className="font-medium text-ink-700 dark:text-ink-200">Calendar week</span> to see
          the whole board for one week.
        </p>
      ) : null}
      <WeekCalendar
        weekStartMs={weekStartMs}
        timezone={timezone}
        busy={busy}
        daySheetGoalBusy={daySheetGoalBusy}
        system={visibleSystem}
        proposed={displayProposed}
        compact={compact}
        dayIndices={dayOffsets}
        onProposedDragCommit={handleProposedDragCommit}
      />
    </div>
  );
}
