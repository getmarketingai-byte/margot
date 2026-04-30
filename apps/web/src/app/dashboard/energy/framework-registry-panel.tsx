"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { FrameworkRegistryId, FrameworkSystem } from "@calendar-automations/schema";
import {
  FRAMEWORK_REGISTRY_DEFAULT_LABELS,
  FRAMEWORK_REGISTRY_DESCRIPTIONS
} from "@calendar-automations/schema";
import { useDebouncedIdleRouterRefresh } from "@/hooks/useDebouncedIdleRouterRefresh";
import { measureServerAck, reportPerceivedInteraction } from "@/lib/ui-perf";
import { persistSchedulerFrameworkInclusion } from "./framework-system-actions";

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

export function FrameworkRegistryPanel({
  initial,
  onSchedulerInclusionChange,
  children
}: {
  initial: FrameworkSystem;
  onSchedulerInclusionChange?: (args: { key: FrameworkRegistryId; enabled: boolean }) => void;
  children?: ReactNode;
}) {
  const [frameworkRows, setFrameworkRows] = useState<FrameworkSystem["frameworks"]>(
    () => [...initial.frameworks].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
  );

  useEffect(() => {
    const sorted = [...initial.frameworks].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
    );
    setFrameworkRows(sorted);
  }, [initial.frameworks]);

  const scheduleStaleDataRefresh = useDebouncedIdleRouterRefresh(900);

  const [busyId, setBusyId] = useState<string | null>(null);

  const frameworks = useMemo(() => [...frameworkRows], [frameworkRows]);

  const patchFrameworkRow = (id: FrameworkRegistryId, patch: Partial<FrameworkSystem["frameworks"][number]>) => {
    setFrameworkRows((rows) =>
      rows
        .map((r) => (r.id === id ? ({ ...r, ...patch } as FrameworkSystem["frameworks"][number]) : r))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    );
  };

  const commitSchedulerIncluded = async (row: FrameworkSystem["frameworks"][number], next: boolean) => {
    const key = mapIdToInclusionKey(row.id);
    if (!key) return;
    const actionId = `fw-scheduler-${row.id}-${next}-${crypto.randomUUID().slice(0, 8)}`;
    reportPerceivedInteraction("framework_scheduler_toggle", actionId);
    patchFrameworkRow(row.id, { enabled: next });
    onSchedulerInclusionChange?.({ key: row.id, enabled: next });
    setBusyId(row.id);
    const t0 = typeof performance !== "undefined" ? performance.now() : 0;
    try {
      await persistSchedulerFrameworkInclusion({ [key]: next });
      measureServerAck(actionId, t0);
      scheduleStaleDataRefresh();
    } catch (err) {
      console.error("persistSchedulerFrameworkInclusion failed", err);
      setFrameworkRows(
        [...initial.frameworks].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      );
      onSchedulerInclusionChange?.({ key: row.id, enabled: !next });
    } finally {
      setBusyId(null);
    }
  };

  const schedRows = SCHEDULER_IDS.map((sid) => frameworks.find((r) => r.id === sid)).filter(
    (r): r is NonNullable<typeof r> => r != null
  );
  const activeSched = schedRows.filter((r) => r.enabled);
  const inactiveSched = schedRows.filter((r) => !r.enabled);

  return (
    <div className="flex flex-col gap-5 border-b border-ink-200 pb-5 dark:border-ink-600">
      <div>
        <h3 className="text-sm font-semibold">Choose frameworks</h3>
        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
          Start from a blank canvas: nothing runs in the allocator until you add frameworks. This list
          is goal-tagging dimensions only. Recurring system blocks (consistency segments and routines)
          are configured in their own surfaces; rule floors (wheel, PPF mix, HP6, etc.) still live
          under{" "}
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
                busy={busyId === row.id}
                inScheduler
                onToggleScheduler={(on) => void commitSchedulerIncluded(row, on)}
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
                busy={busyId === row.id}
                inScheduler={false}
                onToggleScheduler={(on) => void commitSchedulerIncluded(row, on)}
              />
            ))}
          </ul>
        </div>
      )}

      {children ? (
        <div className="border-t border-ink-200 pt-5 dark:border-ink-600">{children}</div>
      ) : null}
    </div>
  );
}

function FrameworkPickerCard({
  row,
  busy,
  inScheduler,
  onToggleScheduler
}: {
  row: FrameworkSystem["frameworks"][number];
  busy: boolean;
  inScheduler: boolean;
  onToggleScheduler: (on: boolean) => void;
}) {
  const label = row.label ?? FRAMEWORK_REGISTRY_DEFAULT_LABELS[row.id];
  const desc = FRAMEWORK_REGISTRY_DESCRIPTIONS[row.id] ?? "";

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-ink-200 bg-ink-50/35 p-3 text-xs dark:border-ink-500 dark:bg-ink-900/40">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-semibold text-ink-800 dark:text-ink-100">{label}</span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-ink-600 dark:text-ink-200">{desc}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-ink-200/80 pt-2 dark:border-ink-600">
        {inScheduler ? (
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
