"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

export type PlanCalendarRangeMode = "calendar-week" | "next-7-days";
export type PlanRollingStatsMode = "split" | "combined";

/** Must match dashboard.plan.calendar.rangeMode in RangeToggleCalendar (legacy installs). */
export const PLAN_CALENDAR_RANGE_MODE_KEY = "dashboard.plan.calendar.rangeMode";
export const PLAN_ROLLING_STATS_MODE_KEY = "dashboard.plan.calendar.rollingStatsMode";

type PlanCalendarViewContextValue = {
  rangeMode: PlanCalendarRangeMode;
  setRangeMode: (m: PlanCalendarRangeMode) => void;
  previewWeekIdx: number;
  setPreviewWeekIdx: React.Dispatch<React.SetStateAction<number>>;
  rollingStatsMode: PlanRollingStatsMode;
  setRollingStatsMode: (m: PlanRollingStatsMode) => void;
};

const PlanCalendarViewContext = createContext<PlanCalendarViewContextValue | null>(null);

export function PlanCalendarViewProvider({
  calendarWeekStartsKey,
  children
}: {
  /** Changes when horizon / week anchors change — resets previewWeekIdx to 0 */
  calendarWeekStartsKey: string;
  children: ReactNode;
}) {
  const [rangeMode, setRangeModeInternal] = useState<PlanCalendarRangeMode>("calendar-week");
  const [previewWeekIdx, setPreviewWeekIdx] = useState(0);
  const [rollingStatsMode, setRollingStatsInternal] = useState<PlanRollingStatsMode>("combined");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PLAN_CALENDAR_RANGE_MODE_KEY);
      if (stored === "calendar-week" || stored === "next-7-days") {
        setRangeModeInternal(stored);
      }
      const rolling = window.localStorage.getItem(PLAN_ROLLING_STATS_MODE_KEY);
      if (rolling === "split" || rolling === "combined") setRollingStatsInternal(rolling);
    } catch {
      // Ignore.
    }
  }, []);

  useEffect(() => {
    setPreviewWeekIdx(0);
  }, [calendarWeekStartsKey]);

  const setRangeMode = useCallback((m: PlanCalendarRangeMode) => {
    setRangeModeInternal(m);
    try {
      window.localStorage.setItem(PLAN_CALENDAR_RANGE_MODE_KEY, m);
    } catch {
      // Ignore.
    }
  }, []);

  const setRollingStatsMode = useCallback((m: PlanRollingStatsMode) => {
    setRollingStatsInternal(m);
    try {
      window.localStorage.setItem(PLAN_ROLLING_STATS_MODE_KEY, m);
    } catch {
      // Ignore.
    }
  }, []);

  const value = useMemo(
    () => ({
      rangeMode,
      setRangeMode,
      previewWeekIdx,
      setPreviewWeekIdx,
      rollingStatsMode,
      setRollingStatsMode
    }),
    [rangeMode, setRangeMode, previewWeekIdx, rollingStatsMode, setRollingStatsMode]
  );

  return (
    <PlanCalendarViewContext.Provider value={value}>{children}</PlanCalendarViewContext.Provider>
  );
}

export function usePlanCalendarView(): PlanCalendarViewContextValue {
  const ctx = useContext(PlanCalendarViewContext);
  if (!ctx)
    throw new Error("usePlanCalendarView requires PlanCalendarViewProvider");
  return ctx;
}
