"use client";

import type { DayOfWeek } from "@margot/schema";

export const WEEKDAY_TOGGLE_OPTIONS: Array<{ value: DayOfWeek; label: string }> = [
  { value: "monday", label: "Mon" },
  { value: "tuesday", label: "Tue" },
  { value: "wednesday", label: "Wed" },
  { value: "thursday", label: "Thu" },
  { value: "friday", label: "Fri" },
  { value: "saturday", label: "Sat" },
  { value: "sunday", label: "Sun" }
];

/** Same weekday chip grid as Perfect Week goal / goal-group “Pinned weekdays”. */
export function WeekdayToggleGrid({
  selected,
  onChange,
  className = "grid grid-cols-7 gap-1"
}: {
  selected: readonly DayOfWeek[] | undefined;
  onChange: (next: DayOfWeek[] | undefined) => void;
  className?: string;
}) {
  const pinned = selected ?? [];
  return (
    <div className={className}>
      {WEEKDAY_TOGGLE_OPTIONS.map((d) => {
        const checked = pinned.includes(d.value);
        return (
          <label
            key={d.value}
            className={`flex cursor-pointer items-center justify-center rounded border px-1 py-1 text-[11px] ${
              checked
                ? "border-accent bg-accent text-accent-fg"
                : "border-ink-200 hover:border-accent/40 dark:border-ink-600"
            }`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={checked}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...pinned, d.value]
                  : pinned.filter((day) => day !== d.value);
                onChange(next.length > 0 ? next : undefined);
              }}
            />
            {d.label}
          </label>
        );
      })}
    </div>
  );
}
