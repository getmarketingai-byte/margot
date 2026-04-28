"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition
} from "react";
import type {
  AllocatedBlockSnapshot,
  BlockMark,
  DailyReview,
  EnergyState,
  EveningScorecard,
  GoalMark,
  Hp6HabitKey,
  LogSlot,
  MorningPrompt,
  WeeklyGoal
} from "@calendar-automations/schema";
import { goalColorFromKey } from "@/lib/goal-colors";
import { formatMinutes } from "../plan/goal-helpers";
import {
  setBlockMark,
  setGoalMark,
  setLogSlots,
  upsertEvening,
  upsertMorning
} from "./actions";

interface DailyReviewClientProps {
  date: string;
  initialReview: DailyReview;
  goals: WeeklyGoal[];
  /** Day-of-week label in the user's TZ. */
  dayLabel: string;
  /** Suggested log range in 15-min row units. */
  logStartMinute: number;
  logEndMinute: number;
}

const SLOT_LENGTH_MIN = 15;

const HP6_HABITS: ReadonlyArray<{ key: Hp6HabitKey; label: string }> = [
  { key: "clarity", label: "Clarity" },
  { key: "energy", label: "Energy" },
  { key: "necessity", label: "Necessity" },
  { key: "productivity", label: "Productivity" },
  { key: "influence", label: "Influence" },
  { key: "courage", label: "Courage" }
];

const ENERGY_OPTIONS: ReadonlyArray<{ key: EnergyState; label: string }> = [
  { key: "energise", label: "Energise" },
  { key: "neutral", label: "Neutral" },
  { key: "drain", label: "Drain" }
];

const CATEGORY_LABEL: Record<LogSlot["category"], string> = {
  goal: "Goal",
  system: "System",
  unplanned: "Unplanned",
  interruption: "Interruption"
};

const STATUS_OPTIONS: ReadonlyArray<{ key: BlockMark["status"]; label: string }> = [
  { key: "done", label: "Done" },
  { key: "partial", label: "Partial" },
  { key: "skipped", label: "Skipped" }
];

const GOAL_STATUS_OPTIONS: ReadonlyArray<{ key: GoalMark["status"]; label: string }> = [
  { key: "done", label: "Done" },
  { key: "partial", label: "Partial" },
  { key: "in-progress", label: "In progress" },
  { key: "skipped", label: "Skipped" }
];

function blockKeyFor(b: AllocatedBlockSnapshot): string {
  return `${b.goalId}:${b.startMs}`;
}

function fmtTime(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function buildSlotIndex(slots: readonly LogSlot[]): Map<number, LogSlot> {
  const out = new Map<number, LogSlot>();
  for (const s of slots) {
    for (let m = s.startMinute; m < s.endMinute; m += SLOT_LENGTH_MIN) {
      out.set(m, s);
    }
  }
  return out;
}

export function DailyReviewClient({
  date,
  initialReview,
  goals,
  dayLabel,
  logStartMinute,
  logEndMinute
}: DailyReviewClientProps) {
  const [review, setReview] = useState<DailyReview>(initialReview);
  const [, startTransition] = useTransition();
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync local state when navigating between dates / fresh server data.
  const lastDateSeen = useRef<string>(date);
  useEffect(() => {
    if (lastDateSeen.current !== date) {
      lastDateSeen.current = date;
      setReview(initialReview);
    }
  }, [date, initialReview]);

  const goalById = useMemo(() => {
    const map = new Map<string, WeeklyGoal>();
    for (const g of goals) map.set(g.id, g);
    return map;
  }, [goals]);

  const slotIndex = useMemo(() => buildSlotIndex(review.slots), [review.slots]);

  const updateMorning = (next: MorningPrompt) => {
    setReview((prev) => ({ ...prev, morning: next }));
    startTransition(() => {
      void upsertMorning(date, next);
    });
  };

  const updateEvening = (next: EveningScorecard) => {
    setReview((prev) => ({ ...prev, evening: next }));
    startTransition(() => {
      void upsertEvening(date, next);
    });
  };

  /**
   * Slot writes are noisy (the user clicks rows in quick succession), so we
   * commit the local state immediately and debounce the server roundtrip
   * by 400ms.
   */
  const flushSlots = (slots: LogSlot[]) => {
    setReview((prev) => ({ ...prev, slots }));
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      startTransition(() => {
        void setLogSlots(date, slots);
      });
    }, 400);
  };

  const updateSlot = (startMinute: number, patch: Partial<LogSlot>) => {
    const existing = slotIndex.get(startMinute);
    const base: LogSlot = existing ?? {
      startMinute,
      endMinute: startMinute + SLOT_LENGTH_MIN,
      category: "goal",
      energy: "neutral"
    };
    const next: LogSlot = {
      ...base,
      ...patch,
      startMinute,
      endMinute: startMinute + SLOT_LENGTH_MIN
    };
    // Delete the old slot for this minute (if it spanned multiple rows we
    // narrow it to just this row for simplicity).
    const without = review.slots.filter(
      (s) => !(s.startMinute <= startMinute && s.endMinute > startMinute)
    );
    flushSlots([...without, next].sort((a, b) => a.startMinute - b.startMinute));
  };

  const clearSlot = (startMinute: number) => {
    const without = review.slots.filter(
      (s) => !(s.startMinute <= startMinute && s.endMinute > startMinute)
    );
    flushSlots(without);
  };

  const updateBlockMark = (
    blockKey: string,
    status: BlockMark["status"] | null
  ) => {
    setReview((prev) => {
      const filtered = prev.blockMarks.filter((m) => m.blockKey !== blockKey);
      if (status === null) return { ...prev, blockMarks: filtered };
      return {
        ...prev,
        blockMarks: [...filtered, { blockKey, status }]
      };
    });
    startTransition(() => {
      void setBlockMark(date, blockKey, status ?? null);
    });
  };

  const updateGoalMark = (goalId: string, patch: Partial<GoalMark>) => {
    setReview((prev) => {
      const existing = prev.goalMarks.find((m) => m.goalId === goalId);
      const merged: GoalMark = {
        goalId,
        status: patch.status ?? existing?.status ?? "in-progress",
        ...(patch.actualMinutes !== undefined
          ? { actualMinutes: patch.actualMinutes }
          : existing?.actualMinutes !== undefined
            ? { actualMinutes: existing.actualMinutes }
            : {}),
        ...(patch.note !== undefined
          ? { note: patch.note }
          : existing?.note !== undefined
            ? { note: existing.note }
            : {})
      };
      const filtered = prev.goalMarks.filter((m) => m.goalId !== goalId);
      return { ...prev, goalMarks: [...filtered, merged] };
    });
    // Server-side persistence runs through the same merge path.
    const existing = review.goalMarks.find((m) => m.goalId === goalId);
    const status = patch.status ?? existing?.status ?? "in-progress";
    const actualMinutes =
      patch.actualMinutes !== undefined
        ? patch.actualMinutes
        : existing?.actualMinutes;
    const note = patch.note !== undefined ? patch.note : existing?.note;
    startTransition(() => {
      void setGoalMark(date, goalId, status, actualMinutes, note);
    });
  };

  const removeGoalMark = (goalId: string) => {
    setReview((prev) => ({
      ...prev,
      goalMarks: prev.goalMarks.filter((m) => m.goalId !== goalId)
    }));
    startTransition(() => {
      void setGoalMark(date, goalId, null);
    });
  };

  const slotMinutes = useMemo(() => {
    const out: number[] = [];
    for (let m = logStartMinute; m < logEndMinute; m += SLOT_LENGTH_MIN) {
      out.push(m);
    }
    return out;
  }, [logStartMinute, logEndMinute]);

  // Per-goal auto-actuals from the slots (used for the Goal card's
  // "auto" placeholder when no manual override exists).
  const slotMinutesByGoal = useMemo(() => {
    const out = new Map<string, number>();
    for (const s of review.slots) {
      if (!s.goalId) continue;
      const minutes = Math.max(0, s.endMinute - s.startMinute);
      out.set(s.goalId, (out.get(s.goalId) ?? 0) + minutes);
    }
    return out;
  }, [review.slots]);

  return (
    <div className="flex flex-col gap-5">
      <MorningCard
        morning={review.morning}
        onChange={updateMorning}
        dayLabel={dayLabel}
      />

      <LogGridCard
        slotMinutes={slotMinutes}
        slotIndex={slotIndex}
        goals={goals}
        onUpdate={updateSlot}
        onClear={clearSlot}
      />

      <BlockMarksCard
        blocks={review.plannedBlocksSnapshot}
        marks={review.blockMarks}
        goalById={goalById}
        onSet={updateBlockMark}
      />

      <GoalMarksCard
        goals={goals}
        marks={review.goalMarks}
        autoMinutes={slotMinutesByGoal}
        onUpdate={updateGoalMark}
        onClear={removeGoalMark}
      />

      <EveningCard evening={review.evening} onChange={updateEvening} />
    </div>
  );
}

function MorningCard({
  morning,
  onChange,
  dayLabel
}: {
  morning: MorningPrompt;
  onChange: (next: MorningPrompt) => void;
  dayLabel: string;
}) {
  const intentions = morning.intentions ?? [];
  const gratitude = morning.gratitude ?? [];
  return (
    <section className="card">
      <header className="mb-2">
        <h2 className="text-sm font-semibold">Morning intentions ({dayLabel})</h2>
        <p className="text-xs text-ink-400">
          Burchard&apos;s HPP morning prime — set the tone for the day.
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <ListInput
          label="Today I'd love to be remembered for…"
          values={intentions}
          maxItems={3}
          onChange={(next) => onChange({ ...morning, intentions: next })}
        />
        <ListInput
          label="I'm grateful for…"
          values={gratitude}
          maxItems={3}
          onChange={(next) => onChange({ ...morning, gratitude: next })}
        />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-ink-600 dark:text-ink-200">
            One thing that would make today excellent
          </span>
          <input
            type="text"
            className="field"
            value={morning.todaysFocus ?? ""}
            onChange={(e) => onChange({ ...morning, todaysFocus: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-ink-600 dark:text-ink-200">HP6 habit to lean into</span>
          <select
            className="field"
            value={morning.hp6Focus ?? ""}
            onChange={(e) =>
              onChange({
                ...morning,
                hp6Focus: (e.target.value || undefined) as Hp6HabitKey | undefined
              })
            }
          >
            <option value="">— none —</option>
            {HP6_HABITS.map((h) => (
              <option key={h.key} value={h.key}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function LogGridCard({
  slotMinutes,
  slotIndex,
  goals,
  onUpdate,
  onClear
}: {
  slotMinutes: number[];
  slotIndex: Map<number, LogSlot>;
  goals: WeeklyGoal[];
  onUpdate: (startMinute: number, patch: Partial<LogSlot>) => void;
  onClear: (startMinute: number) => void;
}) {
  const totalMin = slotMinutes.length * SLOT_LENGTH_MIN;
  const filledMin = slotMinutes
    .map((m) => slotIndex.get(m))
    .filter((s): s is LogSlot => Boolean(s)).length * SLOT_LENGTH_MIN;
  return (
    <section className="card">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">15-minute log</h2>
          <p className="text-xs text-ink-400">
            Dan Martell-style audit — what were you actually doing? Tag the goal
            and how the time felt.
          </p>
        </div>
        <div className="text-xs text-ink-400">
          Captured {formatMinutes(filledMin)} of {formatMinutes(totalMin)} window
        </div>
      </header>
      <ul className="flex flex-col">
        {slotMinutes.map((startMinute) => {
          const slot = slotIndex.get(startMinute);
          const color = slot?.goalId
            ? goalColorFromKey(slot.goalId)
            : "transparent";
          return (
            <li
              key={startMinute}
              className="grid grid-cols-[64px_minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-ink-200 py-1.5 last:border-b-0 dark:border-ink-600"
              style={
                slot?.goalId
                  ? { borderLeftWidth: 3, borderLeftColor: color, paddingLeft: 8 }
                  : undefined
              }
            >
              <div className="font-mono text-xs text-ink-400">
                {fmtTime(startMinute)}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={`Goal at ${fmtTime(startMinute)}`}
                  className="field text-xs"
                  value={
                    slot?.category === "goal" && slot.goalId
                      ? `goal:${slot.goalId}`
                      : slot
                        ? `cat:${slot.category}`
                        : ""
                  }
                  onChange={(e) => {
                    const value = e.target.value;
                    if (!value) {
                      onClear(startMinute);
                      return;
                    }
                    if (value.startsWith("goal:")) {
                      onUpdate(startMinute, {
                        category: "goal",
                        goalId: value.slice(5)
                      });
                    } else if (value.startsWith("cat:")) {
                      onUpdate(startMinute, {
                        category: value.slice(4) as LogSlot["category"],
                        goalId: undefined
                      });
                    }
                  }}
                >
                  <option value="">—</option>
                  <optgroup label="Goals">
                    {goals.map((g) => (
                      <option key={g.id} value={`goal:${g.id}`}>
                        {g.title}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Other">
                    <option value="cat:system">{CATEGORY_LABEL.system}</option>
                    <option value="cat:unplanned">{CATEGORY_LABEL.unplanned}</option>
                    <option value="cat:interruption">{CATEGORY_LABEL.interruption}</option>
                  </optgroup>
                </select>
                <input
                  type="text"
                  className="field text-xs"
                  placeholder="Note (optional)"
                  value={slot?.note ?? ""}
                  disabled={!slot}
                  onChange={(e) =>
                    onUpdate(startMinute, { note: e.target.value || undefined })
                  }
                />
              </div>
              <SegmentedControl
                ariaLabel={`Energy state at ${fmtTime(startMinute)}`}
                options={ENERGY_OPTIONS}
                value={slot?.energy ?? "neutral"}
                onChange={(next) => onUpdate(startMinute, { energy: next })}
                disabled={!slot}
              />
              <button
                type="button"
                className="text-xs text-ink-400 hover:text-ink-900 dark:hover:text-ink-100"
                onClick={() => onClear(startMinute)}
                aria-label={`Clear log at ${fmtTime(startMinute)}`}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function BlockMarksCard({
  blocks,
  marks,
  goalById,
  onSet
}: {
  blocks: AllocatedBlockSnapshot[];
  marks: BlockMark[];
  goalById: Map<string, WeeklyGoal>;
  onSet: (blockKey: string, status: BlockMark["status"] | null) => void;
}) {
  if (blocks.length === 0) {
    return (
      <section className="card">
        <h2 className="text-sm font-semibold">Planned blocks</h2>
        <p className="mt-1 text-xs text-ink-400">
          No allocator blocks were captured for this day. Open this page during
          the planning week to seed the snapshot.
        </p>
      </section>
    );
  }
  const markByKey = new Map(marks.map((m) => [m.blockKey, m] as const));
  const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs);
  return (
    <section className="card">
      <header className="mb-3">
        <h2 className="text-sm font-semibold">Planned blocks</h2>
        <p className="text-xs text-ink-400">
          Mark each scheduled block with what actually happened.
        </p>
      </header>
      <ul className="flex flex-col gap-2">
        {sorted.map((b) => {
          const key = blockKeyFor(b);
          const mark = markByKey.get(key);
          const color = goalColorFromKey(b.goalId);
          const start = new Date(b.startMs);
          const end = new Date(b.endMs);
          const startLabel = start.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          });
          const endLabel = end.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          });
          const goalTitle = goalById.get(b.goalId)?.title ?? b.title;
          return (
            <li
              key={key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink-200 bg-ink-50/40 p-2 dark:border-ink-600 dark:bg-ink-900/40"
              style={{ borderLeftColor: color, borderLeftWidth: 4 }}
            >
              <div>
                <div className="text-sm font-medium" style={{ color }}>
                  {goalTitle}
                </div>
                <div className="text-xs text-ink-400">
                  {startLabel} – {endLabel}
                </div>
              </div>
              <SegmentedControl
                ariaLabel={`Status for ${goalTitle}`}
                options={STATUS_OPTIONS}
                value={mark?.status ?? null}
                onChange={(next) => onSet(key, next === mark?.status ? null : next)}
                allowClear
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function GoalMarksCard({
  goals,
  marks,
  autoMinutes,
  onUpdate,
  onClear
}: {
  goals: WeeklyGoal[];
  marks: GoalMark[];
  autoMinutes: Map<string, number>;
  onUpdate: (goalId: string, patch: Partial<GoalMark>) => void;
  onClear: (goalId: string) => void;
}) {
  if (goals.length === 0) {
    return (
      <section className="card">
        <h2 className="text-sm font-semibold">Goals</h2>
        <p className="mt-1 text-xs text-ink-400">
          Add goals on the Perfect Week page first.
        </p>
      </section>
    );
  }
  const markById = new Map(marks.map((m) => [m.goalId, m] as const));
  return (
    <section className="card">
      <header className="mb-3">
        <h2 className="text-sm font-semibold">Goal status today</h2>
        <p className="text-xs text-ink-400">
          Quick per-goal mark for what you actually did.
        </p>
      </header>
      <ul className="flex flex-col gap-2">
        {goals.map((g) => {
          const mark = markById.get(g.id);
          const color = goalColorFromKey(g.id);
          const auto = autoMinutes.get(g.id) ?? 0;
          return (
            <li
              key={g.id}
              className="rounded-md border border-ink-200 bg-white p-3 dark:border-ink-600 dark:bg-ink-900/60"
              style={{ borderLeftColor: color, borderLeftWidth: 4 }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium" style={{ color }}>
                  {g.title}
                </div>
                <SegmentedControl
                  ariaLabel={`Status for ${g.title}`}
                  options={GOAL_STATUS_OPTIONS}
                  value={mark?.status ?? null}
                  onChange={(next) => {
                    if (next === mark?.status) {
                      onClear(g.id);
                    } else {
                      onUpdate(g.id, { status: next });
                    }
                  }}
                  allowClear
                />
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)]">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-ink-400">Actual minutes</span>
                  <input
                    type="number"
                    min={0}
                    step={15}
                    placeholder={auto > 0 ? `auto: ${auto}` : "0"}
                    className="field text-xs"
                    value={mark?.actualMinutes ?? ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      onUpdate(g.id, {
                        actualMinutes:
                          value === "" ? undefined : Math.max(0, Number(value))
                      });
                    }}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-ink-400">Note</span>
                  <input
                    type="text"
                    className="field text-xs"
                    value={mark?.note ?? ""}
                    onChange={(e) =>
                      onUpdate(g.id, {
                        note: e.target.value || undefined
                      })
                    }
                  />
                </label>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EveningCard({
  evening,
  onChange
}: {
  evening: EveningScorecard;
  onChange: (next: EveningScorecard) => void;
}) {
  return (
    <section className="card">
      <header className="mb-2">
        <h2 className="text-sm font-semibold">Evening scorecard</h2>
        <p className="text-xs text-ink-400">
          Burchard&apos;s HPP evening review — close the loop and rate the day.
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <ListInput
          label="Today's wins"
          values={evening.wins ?? []}
          maxItems={5}
          onChange={(next) => onChange({ ...evening, wins: next })}
        />
        <ListInput
          label="What I'll improve"
          values={evening.improvements ?? []}
          maxItems={5}
          onChange={(next) => onChange({ ...evening, improvements: next })}
        />
      </div>
      <label className="mt-3 flex flex-col gap-1 text-xs">
        <span className="text-ink-400">Tomorrow I will…</span>
        <input
          type="text"
          className="field"
          value={evening.tomorrow ?? ""}
          onChange={(e) => onChange({ ...evening, tomorrow: e.target.value })}
        />
      </label>
      <div className="mt-3">
        <div className="text-xs uppercase tracking-wide text-ink-400">
          HP6 self-rating (1-10)
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {HP6_HABITS.map((h) => {
            const value = evening.hp6Score[h.key];
            return (
              <label key={h.key} className="flex items-center gap-3 text-xs">
                <span className="w-28 shrink-0">{h.label}</span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={value ?? 5}
                  onChange={(e) =>
                    onChange({
                      ...evening,
                      hp6Score: {
                        ...evening.hp6Score,
                        [h.key]: Number(e.target.value)
                      }
                    })
                  }
                  className="flex-1"
                />
                <span className="w-6 text-right font-mono">
                  {value !== undefined ? value : "—"}
                </span>
                {value !== undefined && (
                  <button
                    type="button"
                    className="text-ink-400 hover:text-ink-900 dark:hover:text-ink-100"
                    onClick={() => {
                      const next = { ...evening.hp6Score };
                      delete next[h.key];
                      onChange({ ...evening, hp6Score: next });
                    }}
                    aria-label={`Clear ${h.label} rating`}
                  >
                    ×
                  </button>
                )}
              </label>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ListInput({
  label,
  values,
  maxItems,
  onChange
}: {
  label: string;
  values: string[];
  maxItems: number;
  onChange: (next: string[]) => void;
}) {
  const slots = Array.from({ length: maxItems }, (_, i) => values[i] ?? "");
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="text-ink-400">{label}</span>
      {slots.map((value, idx) => (
        <input
          key={idx}
          type="text"
          className="field"
          value={value}
          onChange={(e) => {
            const next = [...slots];
            next[idx] = e.target.value;
            onChange(next.filter((v) => v.trim().length > 0));
          }}
        />
      ))}
    </div>
  );
}

function SegmentedControl<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  disabled,
  allowClear
}: {
  ariaLabel: string;
  options: ReadonlyArray<{ key: T; label: string }>;
  value: T | null;
  onChange: (next: T) => void;
  disabled?: boolean;
  allowClear?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`flex flex-wrap gap-1 ${disabled ? "opacity-40" : ""}`}
    >
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.key)}
            className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
              active
                ? "border-accent bg-accent text-accent-fg"
                : "border-ink-200 text-ink-600 hover:border-accent/40 hover:text-ink-900 dark:border-ink-600 dark:text-ink-200 dark:hover:text-ink-100"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
      {allowClear && value !== null && (
        <button
          type="button"
          className="rounded-full border border-transparent px-2 py-0.5 text-[11px] text-ink-400 hover:text-ink-900 dark:hover:text-ink-100"
          onClick={() => onChange(value)}
          aria-label="Clear status"
        >
          clear
        </button>
      )}
    </div>
  );
}
