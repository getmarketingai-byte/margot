"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { GymSettings } from "@calendar-automations/schema";
import {
  buildPhysicalRoutinePayload,
  PhysicalActivityConstraintEditor,
  physicalDraftFromGym,
  type PhysicalRoutineDraft
} from "./physical-activity-constraint-editor";
import { savePhysicalActivityRoutine } from "./physical-activity-routine-actions";

export function PhysicalActivityRoutineForm({ initial }: { initial: GymSettings }) {
  const [, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initial.plannerBlockEnabled);
  const [label, setLabel] = useState(initial.blockLabel || "Physical activity");
  const [draft, setDraft] = useState<PhysicalRoutineDraft>(() => physicalDraftFromGym(initial));

  useEffect(() => {
    setEnabled(initial.plannerBlockEnabled);
    setLabel(initial.blockLabel || "Physical activity");
    setDraft(physicalDraftFromGym(initial));
  }, [initial]);

  const payloadJson = useMemo(
    () => JSON.stringify(buildPhysicalRoutinePayload(enabled, label, draft)),
    [enabled, label, draft]
  );

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await savePhysicalActivityRoutine(fd);
    });
  };

  return (
    <form
      onSubmit={submit}
      className="mt-4 flex flex-col gap-3 border-t border-ink-200 pt-4 dark:border-ink-600"
    >
      <input type="hidden" name="routine_payload_json" value={payloadJson} readOnly />
      <p className="text-xs font-medium text-ink-600 dark:text-ink-200">Physical activity (planner)</p>
      <p className="text-[11px] text-ink-400">
        Weekly workout block with drive padding — same engine as calendar gym legs. Configure here
        instead of a Perfect Week goal row.
      </p>
      {enabled ? <input type="hidden" name="planner_block_enabled" value="on" /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-md border border-ink-200 bg-ink-50/50 p-2 dark:border-ink-600 dark:bg-ink-900/40 sm:col-span-2">
          <span className="text-xs font-medium">Block</span>
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
        </div>

        <div className="sm:col-span-2">
          <PhysicalActivityConstraintEditor draft={draft} onChange={setDraft} />
        </div>

        <div className="sm:col-span-2">
          <button type="submit" className="btn-primary text-xs">
            Save physical activity
          </button>
        </div>
      </div>
    </form>
  );
}
