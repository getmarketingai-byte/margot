"use client";

import { useState } from "react";

type BusyHandlingMode = "ignore" | "busy-only" | "all-events" | "invert-free-busy";

interface CalendarOptionsFormProps {
  action: (formData: FormData) => void | Promise<void>;
  externalId: string;
  displayName: string;
  defaultColor: string;
  defaultBusyMode: BusyHandlingMode;
  defaultInvertedGoalTitle: string;
}

export function CalendarOptionsForm({
  action,
  externalId,
  displayName,
  defaultColor,
  defaultBusyMode,
  defaultInvertedGoalTitle
}: CalendarOptionsFormProps) {
  const [busyMode, setBusyMode] = useState<BusyHandlingMode>(defaultBusyMode);
  const [goalTitle, setGoalTitle] = useState(defaultInvertedGoalTitle);
  const isInverted = busyMode === "invert-free-busy";

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="externalId" value={externalId} />
      <input type="hidden" name="displayName" value={displayName} />
      <label className="flex flex-col gap-1 text-xs text-ink-500">
        Display color
        <input
          type="color"
          name="color"
          defaultValue={defaultColor}
          className="h-9 w-14 rounded border border-ink-200 bg-transparent p-1 dark:border-ink-700"
        />
      </label>
      <label className="flex min-w-56 flex-col gap-1 text-xs text-ink-500">
        Free/busy handling
        <select
          name="busyMode"
          value={busyMode}
          onChange={(event) => setBusyMode(event.target.value as BusyHandlingMode)}
          className="h-9 rounded border border-ink-200 bg-white px-2 text-sm text-ink-900 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
        >
          <option value="busy-only">Only events marked busy block time</option>
          <option value="all-events">All events block time</option>
          <option value="invert-free-busy">
            Inverted free/busy (goal must fit this calendar&apos;s free time)
          </option>
          <option value="ignore">Ignore this calendar for planning</option>
        </select>
      </label>
      {isInverted ? (
        <label className="flex min-w-64 flex-col gap-1 text-xs text-ink-500">
          Inverted goal name
          <input
            name="invertedGoalTitle"
            value={goalTitle}
            onChange={(event) => setGoalTitle(event.target.value)}
            placeholder="e.g. Catch up with Sarah"
            className="h-9 rounded border border-ink-200 bg-white px-2 text-sm text-ink-900 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100"
            required
          />
        </label>
      ) : null}
      <button type="submit" className="btn-secondary">
        Save options
      </button>
      {isInverted ? (
        <p className="w-full text-[11px] text-ink-400">
          This creates a goal if it does not already exist.
        </p>
      ) : null}
    </form>
  );
}
