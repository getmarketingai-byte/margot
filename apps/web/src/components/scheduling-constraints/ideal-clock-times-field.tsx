"use client";

import type { PlacementIdealClockFilter } from "@calendar-automations/schema";

export type IdealClockTime = { hour: number; minute: number };

export function normalisePlacementIdealClockFilter(
  f: PlacementIdealClockFilter | undefined
): PlacementIdealClockFilter | undefined {
  if (!f) return undefined;
  const hour = Math.max(0, Math.min(23, Math.round(f.hour)));
  const minute = Math.max(0, Math.min(59, Math.round(f.minute)));
  if (f.kind !== "after" && f.kind !== "before") return undefined;
  return { kind: f.kind, hour, minute };
}

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

/**
 * Optional "after" / "before" local boundary — only matching rows from
 * {@link IdealClockTimesField} participate in ideal-time placement nudges.
 */
export function IdealPlacementClockRelationField({
  value,
  onChange
}: {
  value: PlacementIdealClockFilter | undefined;
  onChange: (next: PlacementIdealClockFilter | undefined) => void;
}) {
  const mode = value ? value.kind : "";
  const hour = value?.hour ?? 12;
  const minute = value?.minute ?? 0;

  return (
    <div className="flex flex-col gap-2 border-t border-ink-200 pt-2 dark:border-ink-600">
      <label className="flex flex-col gap-1 text-[11px] text-ink-500 dark:text-ink-300">
        Use only times
        <select
          className="field text-xs"
          value={mode === "" ? "" : mode}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") {
              onChange(undefined);
              return;
            }
            if (v === "after" || v === "before") {
              onChange(
                normalisePlacementIdealClockFilter({
                  kind: v,
                  hour,
                  minute
                })
              );
            }
          }}
        >
          <option value="">All listed times</option>
          <option value="after">At or after (local)</option>
          <option value="before">Strictly before (local)</option>
        </select>
      </label>
      {value ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px]">
            Hour
            <input
              type="number"
              min={0}
              max={23}
              value={hour}
              onChange={(e) =>
                onChange(
                  normalisePlacementIdealClockFilter({
                    kind: value.kind,
                    hour: Number(e.target.value),
                    minute
                  })
                )
              }
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
              value={minute}
              onChange={(e) =>
                onChange(
                  normalisePlacementIdealClockFilter({
                    kind: value.kind,
                    hour,
                    minute: Number(e.target.value)
                  })
                )
              }
              className="field w-20"
            />
          </label>
        </div>
      ) : null}
      <p className="text-[11px] text-ink-400">
        Narrows which listed ideal start times count toward the soft nudge. For hard day bounds,
        add Earliest hour / Latest hour (separate constraints or Planner cohort fields).
      </p>
    </div>
  );
}
