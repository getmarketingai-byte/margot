"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PersonalSystem, PersonalSystemAdvancedRule } from "@calendar-automations/schema";
import { updatePersonalSystem } from "../plan/actions";

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
  tuningHints,
  variant = "standalone"
}: {
  initial: PersonalSystem;
  dayDrain?: number[];
  tuningHints: string[];
  variant?: "standalone" | "embedded";
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

  const rootSectionClass =
    variant === "embedded" ? "flex flex-col gap-4" : "card flex flex-col gap-4";
  const mainTitleClass =
    variant === "embedded" ? "text-base font-semibold" : "text-sm font-semibold";

  return (
    <section className={rootSectionClass} aria-labelledby="build-system-methods-heading">
      <div>
        {variant === "embedded" ? (
          <h3 id="build-system-methods-heading" className={mainTitleClass}>
            Optional scheduling methods
          </h3>
        ) : (
          <h2 id="build-system-methods-heading" className={mainTitleClass}>
            Build your system
          </h2>
        )}
        <p className="mt-1 text-xs text-ink-600 dark:text-ink-200">
          Turn on only the scheduling methods you want—mix ideas from different sources and tune
          them for your week. What you enable here adds on top of the default allocator; with
          everything off, timing behaves as before.
        </p>
        <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
          Methods use the tags you set on goals in the boards above (e.g. attention, polarity) plus
          optional{" "}
          <Link href="/dashboard/plan" className="underline">
            charge / drain on each goal
          </Link>{" "}
          on My Perfect Week.
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
        <span>Show scheduling methods on this page (saves your preferences)</span>
      </label>

      <div className="rounded-md border border-ink-200/90 dark:border-ink-600">
        <div className="border-b border-ink-200 bg-ink-50/60 px-3 py-2 dark:border-ink-600 dark:bg-ink-900/30">
          <h3 className="text-xs font-semibold">Scheduling methods</h3>
          <p className="mt-0.5 text-[11px] text-ink-500 dark:text-ink-400">
            Each method is optional. Today one lens is wired into the planner; more presets and custom
            labels will follow.
          </p>
        </div>

        <details className="group" open>
          <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-medium marker:content-[''] [&::-webkit-details-marker]:hidden">
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span>Energy and calendar transitions</span>
              <span className="font-normal text-ink-400">
                — one way to model focus vs. draining time; uses calendar load + goal charge/drain
              </span>
            </span>
          </summary>
          <div className="space-y-4 border-t border-ink-200 px-3 pb-3 pt-3 dark:border-ink-600">
            <label className="flex cursor-pointer items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={sys.energyBatterySchedulingEnabled}
                onChange={(e) => {
                  const next = { ...sys, energyBatterySchedulingEnabled: e.target.checked };
                  setSys(next);
                  persist(next);
                }}
              />
              <span>
                <span className="font-medium">Use this method for placement scoring</span>
                <span className="block text-ink-400">
                  Nudges gaps away from back-to-back &quot;drain&quot; blocks and toward recovery or
                  deep-work shape after heavy calendar days. Additive only; core constraints unchanged.
                </span>
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
                Reset sliders for this method
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
                    ? "No hints yet — add charge/drain tags to goals on My Perfect Week, or rely on heavier calendar days to trigger tips."
                    : "Turn on this method to get tuning hints from your week shape."}
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
                Rule cards for this method
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
          </div>
        </details>

        <div className="border-t border-dashed border-ink-200 px-3 py-3 dark:border-ink-600">
          <p className="text-[11px] text-ink-500 dark:text-ink-400">
            More scheduling methods (templates and your own labels) are planned—this area will grow
            without replacing what you already use.
          </p>
          <button
            type="button"
            disabled
            className="mt-2 rounded-md border border-ink-200 px-2.5 py-1 text-[11px] text-ink-400 opacity-70 dark:border-ink-600"
            title="Coming later"
          >
            Add a method (soon)
          </button>
        </div>
      </div>

      {pending ? <p className="text-xs text-ink-400">Saving…</p> : null}
    </section>
  );
}
