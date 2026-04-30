"use client";

import { useMemo, useState, useTransition } from "react";
import type { FrameworkRegistryId, FrameworkSystem } from "@calendar-automations/schema";
import { FRAMEWORK_REGISTRY_DEFAULT_LABELS } from "@calendar-automations/schema";
import { persistSchedulerFrameworkInclusion, updateFrameworkOverlay } from "./framework-system-actions";

export function FrameworkRegistryPanel({ initial }: { initial: FrameworkSystem }) {
  const [, startTransition] = useTransition();
  const frameworks = useMemo(
    () => [...initial.frameworks].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
    [initial.frameworks]
  );

  const [busyId, setBusyId] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col gap-2 border-b border-ink-200 pb-4 dark:border-ink-600">
      <div>
        <h3 className="text-xs font-semibold">Active frameworks</h3>
        <p className="mt-1 text-[11px] text-ink-500 dark:text-ink-400">
          Enable allocator dimensions (boards) and choose which show as tags on proposed blocks in{" "}
          <span className="font-medium">My Perfect Week</span> (Cal).
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {frameworks.map((row) => {
          const label = row.label ?? FRAMEWORK_REGISTRY_DEFAULT_LABELS[row.id];
          const disabled = busyId === row.id || busyId === `ov-${row.id}`;
          const isExtra = row.id === "consistency" || row.id === "routines";

          return (
            <div
              key={row.id}
              className="flex flex-col gap-1 rounded-lg border border-ink-200 bg-ink-50/40 px-2 py-1.5 text-[11px] dark:border-ink-600 dark:bg-ink-900/30"
            >
              <div className="flex items-center gap-2">
                {isExtra ? (
                  <div className="flex flex-1 items-center gap-1.5 font-medium text-ink-500 dark:text-ink-400">
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: row.enabled ? "var(--accent, #6366f1)" : "#94a3b8"
                      }}
                    />
                    <span>{label}</span>
                    <span className="text-[10px] font-normal opacity-90">mirrored</span>
                  </div>
                ) : (
                  <label className="flex flex-1 cursor-pointer items-center gap-1.5 font-medium">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      disabled={disabled}
                      title="Include this framework for scheduling"
                      onChange={(e) => {
                        const key = mapIdToInclusionKey(row.id);
                        if (!key) return;
                        startTransition(async () => {
                          setBusyId(row.id);
                          try {
                            await persistSchedulerFrameworkInclusion({ [key]: e.target.checked });
                          } finally {
                            setBusyId(null);
                          }
                        });
                      }}
                    />
                    <span>{label}</span>
                  </label>
                )}
                <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1 text-ink-500 dark:text-ink-400">
                  <input
                    type="checkbox"
                    checked={row.overlay.enabled !== false}
                    disabled={disabled}
                    title="Show tags on Perfect Week calendar for this framework"
                    onChange={(e) => toggleOverlayCalendar(row.id, e.target.checked)}
                  />
                  Cal
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
