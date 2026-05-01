"use client";

import { useMemo, useState, useTransition } from "react";
import type { WeeklyErrandsRoutine } from "@calendar-automations/schema";
import {
  ConstraintCard,
  IdealClockTimesField,
  normaliseIdealClockTimes,
  PlannerWeekdaysField,
  SessionsPerWeekField,
  type IdealClockTime
} from "@/components/scheduling-constraints";
import { saveWeeklyErrandsRoutine } from "./weekly-errands-routine-actions";

export function WeeklyErrandsRoutineForm({ initial }: { initial: WeeklyErrandsRoutine }) {
  const [, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initial.plannerBlockEnabled);
  const [label, setLabel] = useState(initial.blockLabel || "Errands");
  const [sessions, setSessions] = useState<number | undefined>(initial.sessionsPerWeek);
  const [sessionMinutes, setSessionMinutes] = useState(String(initial.sessionMinutes));
  const [earliestHour, setEarliestHour] = useState(String(initial.earliestHour));
  const [latestHour, setLatestHour] = useState(String(initial.latestHour));
  const [idealTimes, setIdealTimes] = useState<IdealClockTime[]>(() =>
    normaliseIdealClockTimes(initial.idealBlockTimes, { hour: 14, minute: 0 })
  );
  const [pinDays, setPinDays] = useState(
    () => (initial.plannerDaysOfWeek?.length ? initial.plannerDaysOfWeek.join(",") : "")
  );

  const idealJson = useMemo(() => JSON.stringify(idealTimes), [idealTimes]);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await saveWeeklyErrandsRoutine(fd);
    });
  };

  return (
    <form
      onSubmit={submit}
      className="mt-4 flex flex-col gap-3 border-t border-ink-200 pt-4 dark:border-ink-600"
    >
      <input type="hidden" name="errands_ideal_times_json" value={idealJson} readOnly />
      <p className="text-xs font-medium text-ink-600 dark:text-ink-200">Errands (planner)</p>
      <p className="text-[11px] text-ink-400">
        Weekly errands block with preferred local times (scanning / afternoon bias). Configure here
        instead of a Perfect Week goal row.
      </p>
      {enabled ? <input type="hidden" name="errands_planner_block_enabled" value="on" /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <ConstraintCard label="Block" className="sm:col-span-2">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Plan weekly errands block</span>
          </label>
          <label className="mt-3 flex min-w-0 flex-col gap-1 text-xs">
            Block name
            <input
              type="text"
              name="errands_block_label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Errands"
              className="field w-full"
            />
          </label>
        </ConstraintCard>

        <ConstraintCard label="Cadence">
          <SessionsPerWeekField
            name="errands_sessions_per_week"
            value={sessions}
            onChange={setSessions}
            label="Sessions per week"
          />
          <label className="mt-3 flex min-w-0 flex-col gap-1 text-xs">
            Minutes per session
            <input
              type="number"
              name="errands_session_minutes"
              min={1}
              max={240}
              step={5}
              value={sessionMinutes}
              onChange={(e) => setSessionMinutes(e.target.value)}
              className="field w-full"
            />
          </label>
        </ConstraintCard>

        <ConstraintCard label="Placement window">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1 text-xs">
              Earliest hour (0–23)
              <input
                type="number"
                name="errands_earliest_hour"
                min={0}
                max={23}
                value={earliestHour}
                onChange={(e) => setEarliestHour(e.target.value)}
                className="field w-full"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs">
              Latest hour (1–24, exclusive)
              <input
                type="number"
                name="errands_latest_hour"
                min={1}
                max={24}
                value={latestHour}
                onChange={(e) => setLatestHour(e.target.value)}
                className="field w-full"
              />
            </label>
          </div>
        </ConstraintCard>

        <ConstraintCard label="Ideal times of day">
          <IdealClockTimesField value={idealTimes} onChange={setIdealTimes} />
        </ConstraintCard>

        <ConstraintCard label="Weekday pin" className="sm:col-span-2">
          <PlannerWeekdaysField
            name="errands_planner_days"
            value={pinDays}
            onChange={setPinDays}
            placeholder="e.g. tuesday,saturday — leave blank for any day"
          />
        </ConstraintCard>

        <div className="sm:col-span-2">
          <button type="submit" className="btn-primary text-xs">
            Save errands block
          </button>
        </div>
      </div>
    </form>
  );
}
