"use client";

import { useMemo, useState, useTransition } from "react";
import type { DayOfWeek, GymSettings } from "@calendar-automations/schema";
import {
  ConstraintCard,
  IdealClockTimesField,
  normaliseIdealClockTimes,
  WeekdayToggleGrid,
  type IdealClockTime
} from "@/components/scheduling-constraints";
import { savePhysicalActivityRoutine } from "./physical-activity-routine-actions";

export function PhysicalActivityRoutineForm({ initial }: { initial: GymSettings }) {
  const [, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initial.plannerBlockEnabled);
  const [label, setLabel] = useState(initial.blockLabel || "Physical activity");
  const [sessionsPerWeekMin, setSessionsPerWeekMin] = useState(
    String(initial.sessionsPerWeekMin ?? initial.sessionsPerWeek)
  );
  const [sessionsPerWeekMax, setSessionsPerWeekMax] = useState(
    String(initial.sessionsPerWeekMax ?? initial.sessionsPerWeek)
  );
  const [sessionMinutesMin, setSessionMinutesMin] = useState(
    String(initial.sessionMinutesMin ?? initial.runMinutes)
  );
  const [sessionMinutesMax, setSessionMinutesMax] = useState(
    String(initial.sessionMinutesMax ?? initial.runMinutes)
  );
  const [idealTimes, setIdealTimes] = useState<IdealClockTime[]>(() =>
    normaliseIdealClockTimes(initial.idealBlockTimes, { hour: 11, minute: 30 })
  );
  const [pinnedWeekdays, setPinnedWeekdays] = useState<DayOfWeek[] | undefined>(
    () => initial.plannerDaysOfWeek
  );

  const idealJson = useMemo(() => JSON.stringify(idealTimes), [idealTimes]);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await savePhysicalActivityRoutine(fd);
    });
  };

  return (
    <form
      onSubmit={submit}
      className="mt-4 flex flex-col gap-3 border-t border-ink-200 pt-4 dark:border-ink-600"
    >
      <input type="hidden" name="ideal_times_json" value={idealJson} readOnly />
      <input
        type="hidden"
        name="planner_days"
        value={(pinnedWeekdays ?? []).join(",")}
        readOnly
      />
      <p className="text-xs font-medium text-ink-600 dark:text-ink-200">Physical activity (planner)</p>
      <p className="text-[11px] text-ink-400">
        Weekly workout block with drive padding — same engine as calendar gym legs. Configure here
        instead of a Perfect Week goal row.
      </p>
      {enabled ? <input type="hidden" name="planner_block_enabled" value="on" /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <ConstraintCard label="Block" className="sm:col-span-2">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Plan weekly physical activity block</span>
          </label>
          <label className="mt-3 flex min-w-0 flex-col gap-1 text-xs">
            Block name
            <input
              type="text"
              name="block_label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Physical activity"
              className="field w-full"
            />
          </label>
        </ConstraintCard>

        <ConstraintCard label="Cadence">
          <label className="flex min-w-0 flex-col gap-1 text-xs">
            Min sessions per week
            <input
              type="number"
              name="sessions_per_week_min"
              min={1}
              max={14}
              value={sessionsPerWeekMin}
              onChange={(e) => setSessionsPerWeekMin(e.target.value)}
              className="field w-full"
            />
          </label>
          <label className="mt-3 flex min-w-0 flex-col gap-1 text-xs">
            Max sessions per week
            <input
              type="number"
              name="sessions_per_week_max"
              min={1}
              max={14}
              value={sessionsPerWeekMax}
              onChange={(e) => setSessionsPerWeekMax(e.target.value)}
              className="field w-full"
            />
            <span className="text-[11px] text-ink-400">
              Weekly workout minutes use min/max sessions × min/max session length.
            </span>
          </label>
          <label className="mt-3 flex min-w-0 flex-col gap-1 text-xs">
            Min session (minutes)
            <input
              type="number"
              name="session_minutes_min"
              min={1}
              max={240}
              step={1}
              value={sessionMinutesMin}
              onChange={(e) => setSessionMinutesMin(e.target.value)}
              className="field w-full"
            />
          </label>
          <label className="mt-3 flex min-w-0 flex-col gap-1 text-xs">
            Max session (minutes)
            <input
              type="number"
              name="session_minutes_max"
              min={1}
              max={240}
              step={1}
              value={sessionMinutesMax}
              onChange={(e) => setSessionMinutesMax(e.target.value)}
              className="field w-full"
            />
            <span className="text-[11px] text-ink-400">
              Inner workout length each session before drive padding (weekly target uses this range).
            </span>
          </label>
        </ConstraintCard>

        <ConstraintCard label="Ideal times of day">
          <IdealClockTimesField value={idealTimes} onChange={setIdealTimes} />
        </ConstraintCard>

        <ConstraintCard label="Pinned weekdays" className="sm:col-span-2">
          <WeekdayToggleGrid selected={pinnedWeekdays} onChange={setPinnedWeekdays} />
          <p className="mt-2 text-[11px] text-ink-400">Leave all unchecked to allow any day.</p>
        </ConstraintCard>

        <div className="sm:col-span-2">
          <button type="submit" className="btn-primary text-xs">
            Save physical activity
          </button>
        </div>
      </div>
    </form>
  );
}
