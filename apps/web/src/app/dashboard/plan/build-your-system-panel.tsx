"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PersonalSystem, PersonalSystemAdvancedRule } from "@calendar-automations/schema";
import { updatePersonalSystem } from "./actions";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function makeRule(): PersonalSystemAdvancedRule {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    condition: "always",
    prefer: "avoid_back_to_back_drain",
    priority: 50
  };
}

export function BuildYourSystemPanel({
  initial,
  dayDrain,
  tuningHints
}: {
  initial: PersonalSystem;
  dayDrain?: number[];
  tuningHints: string[];
}) {
  const router = useRouter();
  const [sys, setSys] = useState(initial);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setSys(initial);
  }, [initial]);

  function persist(next: PersonalSystem) {
    startTransition(() => {
      void updatePersonalSystem(next).then(() => router.refresh());
    });
  }

  return (
    <section className="card flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold">Build your system</h2>
        <p className="mt-1 text-xs text-ink-600 dark:text-ink-200">
          Optional layer on top of the default allocator. Energy-aware placement only runs when
          enabled below — otherwise the scheduler behaves as before.
        </p>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={sys.enabled}
          onChange={(e) => {
            const next = { ...sys, enabled: e.target.checked };
            setSys(next);
            persist(next);
          }}
        />
        <span>Show this panel and save my preferences</span>
      </label>

      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={sys.energyBatterySchedulingEnabled}
          onChange={(e) => {
            const next = { ...sys, energyBatterySchedulingEnabled: e.target.checked };
            setSys(next);
            persist(next);
          }}
        />
        <span className="font-medium">Energy-aware scheduling</span>
        <span className="text-ink-400">
          (calendar load + goal charge/drain; additive placement scoring)
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span>Drain → drain penalty scale (0–3)</span>
          <input
            type="number"
            min={0}
            max={3}
            step={0.1}
            value={sys.guided.drainTransitionPenaltyScale}
            disabled={pending}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              setSys({
                ...sys,
                guided: {
                  ...sys.guided,
                  drainTransitionPenaltyScale: Math.min(3, Math.max(0, n))
                }
              });
            }}
            className="field"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span>Calendar-heavy day → focus bias (0–2)</span>
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={sys.guided.calendarDrainRecoveryBias}
            disabled={pending}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              setSys({
                ...sys,
                guided: {
                  ...sys.guided,
                  calendarDrainRecoveryBias: Math.min(2, Math.max(0, n))
                }
              });
            }}
            className="field"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={pending}
          onClick={() => {
            const next = {
              ...sys,
              guided: {
                drainTransitionPenaltyScale: 1,
                calendarDrainRecoveryBias: 1
              }
            };
            setSys(next);
            persist(next);
          }}
        >
          Reset guided sliders
        </button>
        <button
          type="button"
          className="btn-primary text-xs"
          disabled={pending}
          onClick={() => persist(sys)}
        >
          Save guided settings
        </button>
      </div>

      {dayDrain && dayDrain.length === 7 && (
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-400">
            This week · calendar load (preview)
          </div>
          <div className="mt-2 flex gap-1">
            {dayDrain.map((d, i) => (
              <div key={DAY_LABELS[i]} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="flex h-12 w-full max-w-[40px] items-end rounded-sm bg-ink-200 dark:bg-ink-700"
                  title={`${DAY_LABELS[i]}: ${Math.round(d * 100)}%`}
                >
                  <div
                    className="w-full rounded-sm bg-accent/70"
                    style={{ height: `${Math.max(8, Math.round(d * 100))}%` }}
                  />
                </div>
                <span className="text-[10px] text-ink-500">{DAY_LABELS[i]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-md border border-ink-200/80 bg-ink-50/50 p-3 dark:border-ink-600 dark:bg-ink-900/30">
        <div className="text-xs font-medium">Suggestions</div>
        {tuningHints.length === 0 ? (
          <p className="mt-1 text-xs text-ink-500">
            {sys.energyBatterySchedulingEnabled
              ? "No hints yet — add charge/drain tags to goals or wait for heavier calendar days."
              : "Turn on energy-aware scheduling to get tuning hints from your week shape."}
          </p>
        ) : (
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-ink-600 dark:text-ink-200">
            {tuningHints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        )}
      </div>

      <details className="rounded-md border border-ink-200 dark:border-ink-600">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
          Advanced rule cards
        </summary>
        <div className="space-y-3 border-t border-ink-200 p-3 dark:border-ink-600">
          {sys.advancedRules.map((rule, idx) => (
            <div
              key={rule.id}
              className="grid gap-2 rounded border border-ink-100 p-2 dark:border-ink-700 sm:grid-cols-2"
            >
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) => {
                    const rules = [...sys.advancedRules];
                    rules[idx] = { ...rule, enabled: e.target.checked };
                    const next = { ...sys, advancedRules: rules };
                    setSys(next);
                    persist(next);
                  }}
                />
                On
              </label>
              <button
                type="button"
                className="justify-self-end text-xs text-red-600"
                onClick={() => {
                  const rules = sys.advancedRules.filter((_, j) => j !== idx);
                  const next = { ...sys, advancedRules: rules };
                  setSys(next);
                  persist(next);
                }}
              >
                Remove
              </button>
              <label className="flex flex-col gap-1 text-xs">
                When
                <select
                  value={rule.condition}
                  onChange={(e) => {
                    const rules = [...sys.advancedRules];
                    rules[idx] = {
                      ...rule,
                      condition: e.target.value as PersonalSystemAdvancedRule["condition"]
                    };
                    const next = { ...sys, advancedRules: rules };
                    setSys(next);
                    persist(next);
                  }}
                  className="field"
                >
                  <option value="always">Always</option>
                  <option value="after_drain_block">After draining block (adjacent)</option>
                  <option value="after_focus_block">After focus block (adjacent)</option>
                  <option value="morning_low_battery">Morning + heavy calendar day</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Prefer
                <select
                  value={rule.prefer}
                  onChange={(e) => {
                    const rules = [...sys.advancedRules];
                    rules[idx] = {
                      ...rule,
                      prefer: e.target.value as PersonalSystemAdvancedRule["prefer"]
                    };
                    const next = { ...sys, advancedRules: rules };
                    setSys(next);
                    persist(next);
                  }}
                  className="field"
                >
                  <option value="avoid_back_to_back_drain">Avoid back-to-back drain</option>
                  <option value="prefer_hyperfocus_goal">Prefer hyper-focus shaped goals</option>
                  <option value="prefer_recovery_play">Prefer recovery / play</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                Priority weight (0–100)
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={rule.priority}
                  onChange={(e) => {
                    const p = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                    const rules = sys.advancedRules.map((r, j) =>
                      j === idx ? { ...r, priority: p } : r
                    );
                    const next = { ...sys, advancedRules: rules };
                    setSys(next);
                    persist(next);
                  }}
                  className="field"
                />
              </label>
            </div>
          ))}
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => {
              const next = { ...sys, advancedRules: [...sys.advancedRules, makeRule()] };
              setSys(next);
              persist(next);
            }}
          >
            + Add rule
          </button>
        </div>
      </details>

      {pending ? <p className="text-xs text-ink-400">Saving…</p> : null}
    </section>
  );
}
