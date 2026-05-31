"use client";

import { useEffect, useState } from "react";
import type { EnergyMode, WeeklyGoal } from "@margot/schema";
import { goalColorFromKey } from "@/lib/goal-colors";

type PatchHandler = (goalId: string, patch: Partial<Omit<WeeklyGoal, "id">>) => void;

/**
 * Per-goal controls for hour-curve energy mode and optional battery overrides.
 * Kept on Planner with framework tagging so Perfect Week stays focused on time budgets.
 */
export function BatteryCurveGoalsPanel({
  goals,
  onPatch
}: {
  goals: WeeklyGoal[];
  onPatch: PatchHandler;
}) {
  if (goals.length === 0) {
    return null;
  }

  return (
    <details className="scroll-mt-6 rounded-lg border border-ink-200 bg-ink-50/30 dark:border-ink-600 dark:bg-ink-900/20" id="battery-curve-goals">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
        Battery &amp; daily curve
      </summary>
      <div className="flex flex-col gap-3 border-t border-ink-200 px-4 pb-4 pt-3 dark:border-ink-600">
        <p className="text-xs text-ink-500 dark:text-ink-300">
          <strong>Energy mode</strong> biases the morning vs afternoon curve.{" "}
          <strong>Focus affinity</strong> or explicit charge/drain values override inferred battery
          scores when the personal-energy method is on — see Framework rule customiser.
        </p>
        <ul className="flex flex-col gap-3">
          {goals.map((goal) => (
            <li
              key={goal.id}
              className="rounded-md border border-ink-200 bg-white p-3 dark:border-ink-600 dark:bg-ink-900/50"
            >
              <BatteryCurveGoalRow goal={goal} onPatch={onPatch} />
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function BatteryCurveGoalRow({ goal, onPatch }: { goal: WeeklyGoal; onPatch: PatchHandler }) {
  const color = goalColorFromKey(goal.id || goal.title);
  const apply = (patch: Partial<Omit<WeeklyGoal, "id">>) => onPatch(goal.id, patch);
  const [chargeStr, setChargeStr] = useState(() =>
    goal.energyChargeImpact !== undefined ? String(goal.energyChargeImpact) : ""
  );
  const [drainStr, setDrainStr] = useState(() =>
    goal.energyDrainImpact !== undefined ? String(goal.energyDrainImpact) : ""
  );

  useEffect(() => {
    setChargeStr(goal.energyChargeImpact !== undefined ? String(goal.energyChargeImpact) : "");
  }, [goal.energyChargeImpact]);

  useEffect(() => {
    setDrainStr(goal.energyDrainImpact !== undefined ? String(goal.energyDrainImpact) : "");
  }, [goal.energyDrainImpact]);

  const commitCharge = () => {
    const raw = chargeStr.trim();
    if (raw === "") {
      apply({ energyChargeImpact: undefined });
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    apply({ energyChargeImpact: Math.min(1, Math.max(0, n)) });
  };

  const commitDrain = () => {
    const raw = drainStr.trim();
    if (raw === "") {
      apply({ energyDrainImpact: undefined });
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    apply({ energyDrainImpact: Math.min(1, Math.max(0, n)) });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="min-w-0 truncate text-xs font-medium" style={{ color }}>
          {goal.title}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex min-w-0 flex-col gap-1 text-xs">
          <span className="text-ink-500 dark:text-ink-300">Energy mode</span>
          <select
            value={goal.energyMode ?? "neutral"}
            onChange={(e) => apply({ energyMode: e.target.value as EnergyMode })}
            className="field w-full"
          >
            <option value="hyperfocus">Deep focus (morning)</option>
            <option value="neutral">Neutral</option>
            <option value="hyperaware">Scanning (afternoon)</option>
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs">
          <span className="text-ink-500 dark:text-ink-300">Focus affinity</span>
          <select
            value={goal.focusAffinity ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              apply({
                focusAffinity:
                  v === "" ? undefined : (v as "hyperfocus" | "hyperaware" | "mixed")
              });
            }}
            className="field w-full"
          >
            <option value="">Infer from tags</option>
            <option value="hyperfocus">Hyper focus (charges)</option>
            <option value="hyperaware">Hyper aware (drains)</option>
            <option value="mixed">Mixed</option>
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs">
          <span className="text-ink-500 dark:text-ink-300">Battery charge (0–1)</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={chargeStr}
            onChange={(e) => setChargeStr(e.target.value)}
            onBlur={commitCharge}
            placeholder="Infer"
            className="field w-full"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs">
          <span className="text-ink-500 dark:text-ink-300">Battery drain (0–1)</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={drainStr}
            onChange={(e) => setDrainStr(e.target.value)}
            onBlur={commitDrain}
            placeholder="Infer"
            className="field w-full"
          />
        </label>
      </div>
    </div>
  );
}
