"use client";

import { useMemo, useState, useTransition } from "react";
import type { GymSettings } from "@calendar-automations/schema";
import {
  ConstraintCard,
  IdealClockTimesField,
  normaliseIdealClockTimes,
  PlannerWeekdaysField,
  SessionsPerWeekField,
  type IdealClockTime
} from "@/components/scheduling-constraints";
import { savePhysicalActivityRoutine } from "./physical-activity-routine-actions";

export function PhysicalActivityRoutineForm({ initial }: { initial: GymSettings }) {
  const [, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initial.plannerBlockEnabled);
  const [label, setLabel] = useState(initial.blockLabel || "Physical activity");
  const [sessions, setSessions] = useState<number | undefined>(initial.sessionsPerWeek);
  const [runMinutes, setRunMinutes] = useState(String(initial.runMinutes));
  const [idealTimes, setIdealTimes] = useState<IdealClockTime[]>(() =>
    normaliseIdealClockTimes(initial.idealBlockTimes, { hour: 11, minute: 30 })
  );
  const [pinDays, setPinDays] = useState(
    () => (initial.plannerDaysOfWeek?.length ? initial.plannerDaysOfWeek.join(",") : "")
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
          <SessionsPerWeekField
            name="sessions_per_week"
            value={sessions}
            onChange={setSessions}
            label="Sessions per week"
          />
          <label className="mt-3 flex min-w-0 flex-col gap-1 text-xs">
            Session length (minutes)
            <input
              type="number"
              name="run_minutes"
              min={1}
              max={240}
              step={5}
              value={runMinutes}
              onChange={(e) => setRunMinutes(e.target.value)}
              className="field w-full"
            />
            <span className="text-[11px] text-ink-400">
              Inner workout block before drive padding (same field as calendar gym run length).
            </span>
          </label>
        </ConstraintCard>

        <ConstraintCard label="Ideal times of day">
          <IdealClockTimesField value={idealTimes} onChange={setIdealTimes} />
        </ConstraintCard>

        <ConstraintCard label="Weekday pin" className="sm:col-span-2">
          <PlannerWeekdaysField
            name="planner_days"
            value={pinDays}
            onChange={setPinDays}
            placeholder="e.g. monday,wednesday,friday — leave blank for any day"
          />
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
