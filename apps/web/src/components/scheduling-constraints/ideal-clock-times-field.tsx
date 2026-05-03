"use client";

import type { PlacementIdealClockBoundary } from "@calendar-automations/schema";
import { normalisePlacementIdealClockBoundary } from "@calendar-automations/schema";

export type IdealClockTime = { hour: number; minute: number };

export function normaliseIdealClockTimes(
  times: readonly IdealClockTime[] | undefined,
  fallback: IdealClockTime
): IdealClockTime[] {
  const out: IdealClockTime[] = [];
  const src = times?.length ? times : [fallback];
  for (const t of src.slice(0, 8)) {
    const hour = Math.max(0, Math.min(23, Math.round(t.hour)));
    const minute = Math.max(0, Math.min(59, Math.round(t.minute)));
    out.push({ hour, minute });
  }
  return out.length > 0 ? out : [fallback];
}

export function IdealClockTimesField({
  value,
  onChange,
  legend = "Ideal start times (local)",
  addLabel = "+ Add time",
  minuteStep = 5
}: {
  value: readonly IdealClockTime[];
  onChange: (next: IdealClockTime[]) => void;
  legend?: string;
  addLabel?: string;
  minuteStep?: number;
}) {
  const addTime = () => {
    onChange(normaliseIdealClockTimes([...value, { hour: 12, minute: 0 }], { hour: 12, minute: 0 }));
  };

  const removeTime = (idx: number) => {
    if (value.length <= 1) return;
    onChange(value.filter((_, i) => i !== idx));
  };

  const updateTime = (idx: number, patch: Partial<IdealClockTime>) => {
    onChange(value.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-500 dark:text-ink-300">{legend}</span>
        <button type="button" onClick={addTime} className="text-[11px] text-accent hover:underline">
          {addLabel}
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {value.map((t, idx) => (
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
                step={minuteStep}
                value={t.minute}
                onChange={(e) => updateTime(idx, { minute: Number(e.target.value) })}
                className="field w-20"
              />
            </label>
            {value.length > 1 ? (
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
  );
}

function boundaryInputs(
  b: PlacementIdealClockBoundary,
  minuteStep: number,
  onPatch: (next: PlacementIdealClockBoundary) => void
) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-[11px]">
        Hour
        <input
          type="number"
          min={0}
          max={23}
          value={b.hour}
          onChange={(e) => {
            const hour = Number(e.target.value);
            const merged = normalisePlacementIdealClockBoundary({ hour, minute: b.minute });
            if (merged) onPatch(merged);
          }}
          className="field w-20"
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px]">
        Minute
        <input
          type="number"
          min={0}
          max={59}
          step={minuteStep}
          value={b.minute}
          onChange={(e) => {
            const minute = Number(e.target.value);
            const merged = normalisePlacementIdealClockBoundary({ hour: b.hour, minute });
            if (merged) onPatch(merged);
          }}
          className="field w-20"
        />
      </label>
    </div>
  );
}

/**
 * Optional local lower bound — only ideal clock rows at or after this time participate in
 * placement nudges (with {@link IdealClockTimesField}).
 */
export function IdealPlacementClockAfterField({
  value,
  onChange,
  minuteStep = 5
}: {
  value: PlacementIdealClockBoundary | undefined;
  onChange: (next: PlacementIdealClockBoundary | undefined) => void;
  minuteStep?: number;
}) {
  const b = value ?? { hour: 18, minute: 0 };
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-ink-500 dark:text-ink-300">At or after (local)</span>
      {boundaryInputs(b, minuteStep, (next) => onChange(next))}
      <p className="text-[11px] text-ink-400">
        If you also set &quot;Ideal times — before&quot; (later on the clock), the planner only places
        this goal inside that combined local window. Without &quot;before&quot;, this row only filters
        which listed ideal start times participate in soft placement nudges.
      </p>
    </div>
  );
}

/**
 * Optional local upper bound (exclusive) — only ideal clock rows strictly before this time
 * participate in placement nudges.
 */
export function IdealPlacementClockBeforeField({
  value,
  onChange,
  minuteStep = 5
}: {
  value: PlacementIdealClockBoundary | undefined;
  onChange: (next: PlacementIdealClockBoundary | undefined) => void;
  minuteStep?: number;
}) {
  const b = value ?? { hour: 22, minute: 0 };
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-ink-500 dark:text-ink-300">Strictly before (local)</span>
      {boundaryInputs(b, minuteStep, (next) => onChange(next))}
      <p className="text-[11px] text-ink-400">
        If you also set &quot;Ideal times — after&quot; (earlier on the clock), the planner only places
        this goal inside that combined local window. Without &quot;after&quot;, this row only filters
        which listed ideal start times participate in soft placement nudges.
      </p>
    </div>
  );
}
