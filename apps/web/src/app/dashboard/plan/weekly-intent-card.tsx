"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { Hp6HabitKey, WeeklyIntent } from "@calendar-automations/schema";

interface IntentField {
  key: keyof WeeklyIntent;
  label: string;
  hint: string;
  rows?: number;
}

const INTENT_TEXT_FIELDS: ReadonlyArray<IntentField> = [
  {
    key: "mainOutcomes",
    label: "Main outcomes",
    hint: "1-3 things that would make this week a win.",
    rows: 3
  },
  {
    key: "mustWins",
    label: "Must-wins vs stretch",
    hint: "What absolutely has to land - and what would be a bonus.",
    rows: 3
  },
  {
    key: "people",
    label: "People & relationships",
    hint: "Who do you want to show up for this week?",
    rows: 2
  },
  {
    key: "energyNote",
    label: "Energy & recovery",
    hint: "How will you protect or generate energy?",
    rows: 2
  },
  {
    key: "mindsetNote",
    label: "Mindset & standard",
    hint: "What standard are you holding yourself to?",
    rows: 2
  }
];

const HP6_KEYS: readonly Hp6HabitKey[] = [
  "clarity",
  "energy",
  "necessity",
  "productivity",
  "influence",
  "courage"
];

const HP6_LABELS: Record<Hp6HabitKey, string> = {
  clarity: "Clarity",
  energy: "Energy",
  necessity: "Necessity",
  productivity: "Productivity",
  influence: "Influence",
  courage: "Courage"
};

export function WeeklyIntentCard({
  initial,
  save,
  variant = "standalone"
}: {
  initial: WeeklyIntent;
  save: (input: WeeklyIntent) => Promise<void>;
  /** Use `embedded` inside a parent Planning card so we don&apos;t nest full cards. */
  variant?: "standalone" | "embedded";
}) {
  const [intent, setIntent] = useState<WeeklyIntent>(initial);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const externalSig = useMemo(() => JSON.stringify(initial), [initial]);

  useEffect(() => {
    setIntent(initial);
  }, [externalSig, initial]);

  const persist = (next: WeeklyIntent) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      startTransition(async () => {
        try {
          await save(next);
        } catch (err) {
          console.error("saveWeeklyIntent failed", err);
        }
      });
    }, 400);
  };

  const updateField = (key: keyof WeeklyIntent, value: string) => {
    const next = { ...intent, [key]: value };
    setIntent(next);
    persist(next);
  };

  const toggleHabit = (habit: Hp6HabitKey) => {
    const current = intent.hp6Focus ?? [];
    const has = current.includes(habit);
    const nextHabits = has ? current.filter((h) => h !== habit) : [...current, habit];
    const next = { ...intent, hp6Focus: nextHabits };
    setIntent(next);
    persist(next);
  };

  const filledCount = INTENT_TEXT_FIELDS.filter(
    (f) => ((intent[f.key] ?? "") as string).trim().length > 0
  ).length;
  const habitCount = (intent.hp6Focus ?? []).length;

  const headingId =
    variant === "embedded" ? "weekly-intent-nested-heading" : "weekly-intent-heading";
  const rootClass =
    variant === "embedded" ? "flex flex-col gap-3" : "card flex flex-col gap-3";

  return (
    <section className={rootClass} aria-labelledby={headingId}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-start justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <div>
          {variant === "embedded" ? (
            <h3 id={headingId} className="text-sm font-semibold">
              This week&apos;s intentions
            </h3>
          ) : (
            <h2 id={headingId} className="text-sm font-semibold">
              This week&apos;s intentions
            </h2>
          )}
          <p className="text-xs text-ink-400">
            Weekly prompts to anchor the week before filling your goal list.
          </p>
        </div>
        <span className="shrink-0 text-xs text-ink-400">
          {filledCount + (habitCount > 0 ? 1 : 0) === 0
            ? open
              ? "Tap to collapse"
              : "Tap to fill"
            : `${filledCount} filled${habitCount > 0 ? ` · ${habitCount} habits` : ""}`}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-ink-200 pt-3 dark:border-ink-600">
          {INTENT_TEXT_FIELDS.map((field) => (
            <label key={field.key} className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{field.label}</span>
              <span className="text-[11px] text-ink-400">{field.hint}</span>
              <textarea
                rows={field.rows ?? 2}
                className="field"
                value={(intent[field.key] as string | undefined) ?? ""}
                onChange={(e) => updateField(field.key, e.target.value)}
              />
            </label>
          ))}
          <fieldset className="flex flex-col gap-2 rounded-md border border-ink-200 p-2 dark:border-ink-600">
            <legend className="px-1 text-xs font-medium">HP6 focus this week</legend>
            <p className="text-[11px] text-ink-400">
              Optional habits to emphasize this week.
            </p>
            <div className="flex flex-wrap gap-2">
              {HP6_KEYS.map((habit) => {
                const active = (intent.hp6Focus ?? []).includes(habit);
                return (
                  <button
                    key={habit}
                    type="button"
                    onClick={() => toggleHabit(habit)}
                    aria-pressed={active}
                    className={`rounded-full border px-2.5 py-1 text-xs transition ${
                      active
                        ? "border-accent bg-accent text-accent-fg"
                        : "border-ink-200 text-ink-600 hover:border-accent/40 dark:border-ink-600 dark:text-ink-200"
                    }`}
                  >
                    {HP6_LABELS[habit]}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>
      )}
    </section>
  );
}
