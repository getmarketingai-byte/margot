"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { FrameworkRegistryId, FrameworkSystem } from "@margot/schema";
import {
  FRAMEWORK_REGISTRY_DEFAULT_LABELS,
  FRAMEWORK_REGISTRY_DESCRIPTIONS
} from "@margot/schema";
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
  children,
  renderSchedulerCardContent
}: {
  initial: FrameworkSystem;
  onSchedulerInclusionChange?: (args: { key: FrameworkRegistryId; enabled: boolean }) => void;
  children?: ReactNode;
  renderSchedulerCardContent?: (row: FrameworkSystem["frameworks"][number]) => ReactNode;
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
          Tag dimensions only — add a framework to unlock its board. Set floors and mix under{" "}
          <a className="underline" href="#planner-rules">
            Rules
          </a>
          ; global options under{" "}
          <a className="underline" href="#planner-scheduling">
            Scheduling
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
          <ul
            className={`grid gap-3 ${renderSchedulerCardContent ? "grid-cols-1" : "sm:grid-cols-2"}`}
          >
            {activeSched.map((row) => (
              <FrameworkPickerCard
                key={row.id}
                row={row}
                busy={busyId === row.id}
                inScheduler
                onToggleScheduler={(on) => void commitSchedulerIncluded(row, on)}
                extraContent={renderSchedulerCardContent?.(row)}
              />
            ))}
          </ul>
          {children ? (
            <div className="mt-3 border-t border-ink-200 pt-4 dark:border-ink-600">{children}</div>
          ) : null}
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

      {activeSched.length === 0 && children ? (
        <div className="border-t border-ink-200 pt-5 dark:border-ink-600">{children}</div>
      ) : null}

    </div>
  );
}

function FrameworkPickerCard({
  row,
  busy,
  inScheduler,
  onToggleScheduler,
  extraContent
}: {
  row: FrameworkSystem["frameworks"][number];
  busy: boolean;
  inScheduler: boolean;
  onToggleScheduler: (on: boolean) => void;
  extraContent?: ReactNode;
}) {
  const label = row.label ?? FRAMEWORK_REGISTRY_DEFAULT_LABELS[row.id];
  const desc = FRAMEWORK_REGISTRY_DESCRIPTIONS[row.id] ?? "";

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-ink-200 bg-ink-50/35 p-3 text-xs dark:border-ink-500 dark:bg-ink-900/40">
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
      {extraContent ? (
        <div className="rounded-md border border-ink-200/80 bg-white/70 p-2.5 dark:border-ink-600 dark:bg-ink-900/30">
          {extraContent}
        </div>
      ) : null}
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
