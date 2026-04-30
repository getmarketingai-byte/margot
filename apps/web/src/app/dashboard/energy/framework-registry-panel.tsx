"use client";

import { useMemo, useState, useTransition } from "react";
import type { FrameworkRegistryId, FrameworkSystem } from "@calendar-automations/schema";
import {
  FRAMEWORK_REGISTRY_DEFAULT_LABELS,
  FRAMEWORK_REGISTRY_DESCRIPTIONS
} from "@calendar-automations/schema";
import { persistSchedulerFrameworkInclusion, updateFrameworkOverlay } from "./framework-system-actions";

const SCHEDULER_IDS = [
  "commitment",
  "polarity",
  "attention",
  "workLayer",
  "wheel",
  "ppfPillar",
  "ppfHorizon",
  "hp6"
] as const satisfies readonly FrameworkRegistryId[];

export function FrameworkRegistryPanel({ initial }: { initial: FrameworkSystem }) {
  const [, startTransition] = useTransition();
  const frameworks = useMemo(
    () => [...initial.frameworks].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
    [initial.frameworks]
  );

  const [busyId, setBusyId] = useState<string | null>(null);

  const setSchedulerIncluded = async (row: FrameworkSystem["frameworks"][number], next: boolean) => {
    const key = mapIdToInclusionKey(row.id);
    if (!key) return;
    startTransition(async () => {
      setBusyId(row.id);
      try {
        await persistSchedulerFrameworkInclusion({ [key]: next });
        if (!next) await updateFrameworkOverlay(row.id, { enabled: false });
      } finally {
        setBusyId(null);
      }
    });
  };

  const toggleOverlayCalendar = (id: FrameworkRegistryId, nextOverlay: boolean) => {
    startTransition(async () => {
      setBusyId(`ov-${id}`);
      try {
        await updateFrameworkOverlay(id, { enabled: nextOverlay });
      } finally {
        setBusyId(null);
      }
    });
  };

  const schedRows = SCHEDULER_IDS.map((sid) => frameworks.find((r) => r.id === sid)).filter(
    (r): r is NonNullable<typeof r> => r != null
  );
  const activeSched = schedRows.filter((r) => r.enabled);
  const inactiveSched = schedRows.filter((r) => !r.enabled);
  const mirrored = frameworks.filter((r) => r.id === "consistency" || r.id === "routines");

  return (
    <div className="flex flex-col gap-5 border-b border-ink-200 pb-5 dark:border-ink-600">
      <div>
        <h3 className="text-sm font-semibold">Choose frameworks</h3>
        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
          Start from a blank canvas: nothing runs in the allocator until you add frameworks. Pick only
          the dimensions you classify goals against; rule floors (wheel, PPF mix, HP6, etc.) still
          live under{" "}
          <a className="underline" href="#scheduling-outcomes-heading">
            Scheduling outcomes
          </a>
          .
        </p>
      </div>

      {activeSched.length === 0 && inactiveSched.length > 0 && (
        <p className="rounded-md border border-dashed border-ink-300 bg-ink-50/50 px-3 py-2 text-[11px] text-ink-600 dark:border-ink-600 dark:bg-ink-900/30 dark:text-ink-300">
          No frameworks in the allocator yet — add one below to unlock goal tagging boards.
        </p>
      )}

      {activeSched.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
            Active in scheduler ({activeSched.length})
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {activeSched.map((row) => (
              <FrameworkPickerCard
                key={row.id}
                row={row}
                busy={busyId === row.id || busyId === `ov-${row.id}`}
                inScheduler
                mirror={false}
                onToggleScheduler={(on) => setSchedulerIncluded(row, on)}
                onToggleCal={(enabled) => toggleOverlayCalendar(row.id, enabled)}
              />
            ))}
          </ul>
        </div>
      )}

      {inactiveSched.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
            Available to add ({inactiveSched.length})
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {inactiveSched.map((row) => (
              <FrameworkPickerCard
                key={row.id}
                row={row}
                busy={busyId === row.id || busyId === `ov-${row.id}`}
                inScheduler={false}
                mirror={false}
                onToggleScheduler={(on) => setSchedulerIncluded(row, on)}
                onToggleCal={(enabled) => toggleOverlayCalendar(row.id, enabled)}
              />
            ))}
          </ul>
        </div>
      )}

      {mirrored.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-ink-200 pt-4 dark:border-ink-600">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
            Calendar overlays (mirrored)
          </p>
          <p className="text-[11px] text-ink-500 dark:text-ink-400">
            Reflect settings elsewhere — you can&apos;t toggle allocator behavior here, only Perfect
            Week tags.
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {mirrored.map((row) => (
              <FrameworkPickerCard
                key={row.id}
                row={row}
                busy={busyId === `ov-${row.id}`}
                inScheduler={false}
                mirror
                onToggleScheduler={() => {}}
                onToggleCal={(enabled) => toggleOverlayCalendar(row.id, enabled)}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FrameworkPickerCard({
  row,
  busy,
  inScheduler,
  mirror,
  onToggleScheduler,
  onToggleCal
}: {
  row: FrameworkSystem["frameworks"][number];
  busy: boolean;
  inScheduler: boolean;
  mirror: boolean;
  onToggleScheduler: (on: boolean) => void;
  onToggleCal: (enabled: boolean) => void;
}) {
  const label = row.label ?? FRAMEWORK_REGISTRY_DEFAULT_LABELS[row.id];
  const desc = FRAMEWORK_REGISTRY_DESCRIPTIONS[row.id];

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-ink-200 bg-ink-50/35 p-3 text-xs dark:border-ink-600 dark:bg-ink-900/25">
      <div className="flex items-start gap-2">
        {mirror && (
          <span
            aria-hidden
            className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
            style={{
              backgroundColor: row.enabled ? "var(--accent, #6366f1)" : "#94a3b8"
            }}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-semibold text-ink-800 dark:text-ink-100">{label}</span>
            {mirror && (
              <span className="text-[10px] font-medium text-ink-500 dark:text-ink-400">mirrored</span>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-ink-600 dark:text-ink-300">{desc}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-ink-200/80 pt-2 dark:border-ink-700">
        {mirror ? null : inScheduler ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onToggleScheduler(false)}
            className="btn-secondary text-[11px] py-1 px-2"
          >
            Remove from scheduler
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => onToggleScheduler(true)}
            className="btn-primary text-[11px] py-1 px-2"
          >
            Add to scheduler
          </button>
        )}
        {(inScheduler || mirror) && (
          <label
            className={`ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-600 dark:text-ink-300 ${
              !inScheduler && !mirror ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            <input
              type="checkbox"
              checked={row.overlay.enabled !== false}
              disabled={busy}
              title="Show tags on proposed blocks on My Perfect Week"
              onChange={(e) => onToggleCal(e.target.checked)}
            />
            Perfect Week overlay
          </label>
        )}
      </div>
    </li>
  );
}

function mapIdToInclusionKey(
  id: FrameworkRegistryId
):
  | "commitment"
  | "polarity"
  | "attention"
  | "workLayer"
  | "wheel"
  | "ppfPillar"
  | "ppfHorizon"
  | "hp6"
  | null {
  switch (id) {
    case "commitment":
      return "commitment";
    case "polarity":
      return "polarity";
    case "attention":
      return "attention";
    case "workLayer":
      return "workLayer";
    case "wheel":
      return "wheel";
    case "ppfPillar":
      return "ppfPillar";
    case "ppfHorizon":
      return "ppfHorizon";
    case "hp6":
      return "hp6";
    default:
      return null;
  }
}
