"use client";

import { useMemo, useState, useTransition } from "react";
import type { GymSettings } from "@calendar-automations/schema";
import { savePhysicalActivityRoutine } from "./physical-activity-routine-actions";

type Clock = { hour: number; minute: number };

function normaliseTimes(times: readonly Clock[]): Clock[] {
  const out: Clock[] = [];
  for (const t of times.slice(0, 8)) {
    const hour = Math.max(0, Math.min(23, Math.round(t.hour)));
    const minute = Math.max(0, Math.min(59, Math.round(t.minute)));
    out.push({ hour, minute });
  }
  return out.length > 0 ? out : [{ hour: 11, minute: 30 }];
}

export function PhysicalActivityRoutineForm({ initial }: { initial: GymSettings }) {
  const [, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initial.plannerBlockEnabled);
  const [label, setLabel] = useState(initial.blockLabel || "Physical activity");
  const [sessions, setSessions] = useState(String(initial.sessionsPerWeek));
  const [runMinutes, setRunMinutes] = useState(String(initial.runMinutes));
  const [idealTimes, setIdealTimes] = useState<Clock[]>(() =>
    normaliseTimes(initial.idealBlockTimes ?? [{ hour: 11, minute: 30 }])
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

  const addTime = () => {
    setIdealTimes((prev) => normaliseTimes([...prev, { hour: 12, minute: 0 }]));
  };

  const removeTime = (idx: number) => {
    setIdealTimes((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const updateTime = (idx: number, patch: Partial<Clock>) => {
    setIdealTimes((prev) =>
      prev.map((t, i) => (i === idx ? { ...t, ...patch } : t))
    );
  };

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3 border-t border-ink-200 pt-4 dark:border-ink-600">
      <input type="hidden" name="ideal_times_json" value={idealJson} readOnly />
      <p className="text-xs font-medium text-ink-600 dark:text-ink-200">Physical activity (planner)</p>
      <p className="text-[11px] text-ink-400">
        Weekly workout block with drive padding — same engine as calendar gym legs. Configure here
        instead of adding a &quot;special goal&quot; on Perfect Week.
      </p>
      {enabled ? <input type="hidden" name="planner_block_enabled" value="on" /> : null}
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>Plan weekly physical activity block</span>
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs">
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
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        Sessions per week
        <input
          type="number"
          name="sessions_per_week"
          min={1}
          max={14}
          value={sessions}
          onChange={(e) => setSessions(e.target.value)}
          className="field w-full"
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs">
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
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-500 dark:text-ink-300">Ideal times of day (local)</span>
          <button type="button" onClick={addTime} className="text-[11px] text-accent hover:underline">
            + Add time
          </button>
        </div>
        <ul className="flex flex-col gap-2">
          {idealTimes.map((t, idx) => (
            <li key={idx} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-[11px]">
                Hour
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={t.hour}
                  onChange={(e) => updateTime(idx, { hour: Number(e.target.value) })}
                  className="field w-20"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px]">
                Minute
                <input
                  type="number"
                  min={0}
                  max={59}
                  step={5}
                  value={t.minute}
                  onChange={(e) => updateTime(idx, { minute: Number(e.target.value) })}
                  className="field w-20"
                />
              </label>
              {idealTimes.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeTime(idx)}
                  className="mb-0.5 text-[11px] text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        Only on these weekdays (optional)
        <input
          type="text"
          name="planner_days"
          value={pinDays}
          onChange={(e) => setPinDays(e.target.value)}
          placeholder="e.g. monday,wednesday,friday — leave blank for any day"
          className="field w-full"
        />
        <span className="text-[11px] text-ink-400">Comma-separated English weekday names.</span>
      </label>
      <button type="submit" className="btn-primary w-fit text-xs">
        Save physical activity
      </button>
    </form>
  );
}
