"use client";

import { useState } from "react";
import { formatMinutes } from "@/app/dashboard/plan/goal-helpers";

const DURATION_SLIDER_STEP = 5;

function UnitToggle({
  value,
  onChange,
  ariaLabel,
  options
}: {
  value: "hours" | "minutes";
  onChange: (v: "hours" | "minutes") => void;
  ariaLabel?: string;
  options?: ReadonlyArray<{ value: "hours" | "minutes"; label: string }>;
}) {
  const toggleOptions = options ?? [
    { value: "hours", label: "h" },
    { value: "minutes", label: "m" }
  ];
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel ?? "Unit"}
      className="flex shrink-0 overflow-hidden rounded-md border border-ink-200 text-xs dark:border-ink-600"
    >
      {toggleOptions.map((unit) => (
        <button
          key={unit.value}
          type="button"
          role="radio"
          aria-checked={value === unit.value}
          onClick={() => onChange(unit.value)}
          className={`px-2 py-1 ${
            value === unit.value
              ? "bg-accent text-accent-fg"
              : "text-ink-400 hover:text-ink-900 dark:hover:text-ink-100"
          }`}
        >
          {unit.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Combined number + h/m unit toggle for any "minutes" field. Stores minutes
 * internally and lets the user input either decimal hours (1.5) or whole
 * minutes (90). Defaults to hours since most goals are expressed that way.
 */
export function DurationField({
  value,
  onChange,
  hint,
  sliderMinMinutes = 0,
  sliderMaxMinutes = 40 * 60
}: {
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  hint?: string;
  /** Inclusive lower bound for the scrubber (minutes). */
  sliderMinMinutes?: number;
  /** Inclusive upper bound for the scrubber (minutes). Values above still show in the numeric field; the thumb stays at the high end until moved. */
  sliderMaxMinutes?: number;
}) {
  const [unit, setUnit] = useState<"hours" | "minutes">("hours");

  const display = value === undefined ? "" : unit === "hours" ? String(value / 60) : String(value);

  const onInput = (raw: string) => {
    if (raw === "") return onChange(undefined);
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onChange(Math.max(0, Math.round(unit === "hours" ? n * 60 : n)));
  };

  const minutes = value ?? 0;
  const sliderThumbMinutes = Math.min(sliderMaxMinutes, Math.max(sliderMinMinutes, minutes));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <input
          type="number"
          min={0}
          step={unit === "hours" ? 0.25 : 15}
          value={display}
          onChange={(e) => onInput(e.target.value)}
          className="field !w-auto min-w-[6rem] flex-1 basis-0 tabular-nums"
        />
        <UnitToggle
          value={unit}
          onChange={setUnit}
          ariaLabel="Unit"
          options={[
            { value: "hours", label: "h" },
            { value: "minutes", label: "m" }
          ]}
        />
      </div>
      {value !== undefined ? (
        <p className="text-[11px] font-medium tabular-nums text-ink-700 dark:text-ink-200">
          {formatMinutes(value)}
        </p>
      ) : (
        <p className="text-[11px] text-ink-400">No duration set</p>
      )}
      <label className="flex flex-col gap-1">
        <span className="sr-only">Adjust duration with a slider</span>
        <input
          type="range"
          min={sliderMinMinutes}
          max={sliderMaxMinutes}
          step={DURATION_SLIDER_STEP}
          value={sliderThumbMinutes}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (!Number.isFinite(next)) return;
            onChange(next);
          }}
          className="h-2 w-full cursor-pointer accent-accent"
          aria-valuetext={value !== undefined ? formatMinutes(value) : undefined}
        />
      </label>
      {hint ? <span className="text-[11px] text-ink-400">{hint}</span> : null}
    </div>
  );
}
