"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type {
  BurchardWeeklyQuestions,
  EnergyState,
  WeeklyGoal,
  WeeklyReview
} from "@calendar-automations/schema";
import type { GoalRollup, PaceStatus } from "@/lib/review-rollup";
import { goalColorFromKey } from "@/lib/goal-colors";
import { formatMinutes } from "../plan/goal-helpers";
import { applyCatchUp, clearCatchUp, upsertBurchardWeekly } from "./actions";

interface WeeklyReviewClientProps {
  weekStart: string;
  weekDates: string[];
  initialReview: WeeklyReview;
  rollups: GoalRollup[];
  goals: WeeklyGoal[];
  energyTotals: Record<EnergyState, number>;
  drainCandidates: Array<{ key: string; label: string; minutes: number }>;
  /** History excerpts pulled from the week's daily reviews. */
  dailyHighlights: {
    wins: Array<{ date: string; text: string }>;
    improvements: Array<{ date: string; text: string }>;
    intentions: Array<{ date: string; text: string }>;
  };
  catchUpMode: "automated" | "manual";
  /** Floors the allocator uses this week (auto-derived or saved manual). */
  allocatorCatchUpFloors: Record<string, number>;
}

const STATUS_LABEL: Record<PaceStatus, string> = {
  ahead: "Ahead",
  "on-track": "On track",
  behind: "Behind",
  "no-data": "No data"
};

const STATUS_BG: Record<PaceStatus, string> = {
  ahead: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  "on-track": "bg-ink-100 text-ink-900 dark:bg-ink-900/40 dark:text-ink-100",
  behind: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  "no-data": "bg-ink-100 text-ink-400 dark:bg-ink-900/40 dark:text-ink-400"
};

export function WeeklyReviewClient({
  weekStart,
  weekDates,
  initialReview,
  rollups,
  goals,
  energyTotals,
  drainCandidates,
  dailyHighlights,
  catchUpMode,
  allocatorCatchUpFloors
}: WeeklyReviewClientProps) {
  const [review, setReview] = useState<WeeklyReview>(initialReview);
  const [edits, setEdits] = useState<Record<string, number>>(
    initialReview.catchUpAdjustments ?? {}
  );
  const [, startTransition] = useTransition();
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pre-fill edits with the recommendations the first time we see new rollups
  // that have no existing adjustment. Lets the user just hit Apply.
  useEffect(() => {
    if (catchUpMode !== "manual") return;
    setEdits((prev) => {
      const next = { ...prev };
      for (const r of rollups) {
        if (next[r.goalId] === undefined && r.catchUpRecommendation > 0) {
          next[r.goalId] = r.catchUpRecommendation;
        }
      }
      return next;
    });
  }, [rollups, catchUpMode]);

  const goalById = useMemo(() => {
    const map = new Map<string, WeeklyGoal>();
    for (const g of goals) map.set(g.id, g);
    return map;
  }, [goals]);

  const updateBurchard = (next: BurchardWeeklyQuestions) => {
    setReview((prev) => ({ ...prev, burchardQuestions: next }));
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      startTransition(() => {
        void upsertBurchardWeekly(weekStart, next);
      });
    }, 500);
  };

  const submitCatchUp = () => {
    startTransition(() => {
      void applyCatchUp(weekStart, edits).then(() =>
        setReview((prev) => ({
          ...prev,
          catchUpAdjustments: edits,
          appliedAt:
            Object.values(edits).some((v) => v !== 0) ? Date.now() : undefined
        }))
      );
    });
  };

  const resetCatchUp = () => {
    setEdits({});
    startTransition(() => {
      void clearCatchUp(weekStart).then(() =>
        setReview((prev) => ({
          ...prev,
          catchUpAdjustments: {},
          appliedAt: undefined
        }))
      );
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <PaceBoard rollups={rollups} goalById={goalById} weekDates={weekDates} />

      {catchUpMode === "manual" ? (
        <CatchUpPlanner
          rollups={rollups}
          goalById={goalById}
          edits={edits}
          applied={review.catchUpAdjustments ?? {}}
          appliedAt={review.appliedAt}
          onChange={(goalId, minutes) =>
            setEdits((prev) => ({ ...prev, [goalId]: minutes }))
          }
          onSubmit={submitCatchUp}
          onReset={resetCatchUp}
        />
      ) : (
        <AutomatedCatchUpSummary
          allocatorFloors={allocatorCatchUpFloors}
          goalById={goalById}
        />
      )}

      <BurchardWeeklyCard
        questions={review.burchardQuestions}
        onChange={updateBurchard}
        highlights={dailyHighlights}
      />

      <EnergySummaryCard
        totals={energyTotals}
        drainCandidates={drainCandidates}
      />
    </div>
  );
}

function PaceBoard({
  rollups,
  goalById,
  weekDates
}: {
  rollups: GoalRollup[];
  goalById: Map<string, WeeklyGoal>;
  weekDates: string[];
}) {
  if (rollups.length === 0) {
    return (
      <section className="card">
        <h2 className="text-sm font-semibold">Pace</h2>
        <p className="mt-1 text-xs text-ink-400">
          No goals yet. Add some on the Perfect Week page.
        </p>
      </section>
    );
  }
  return (
    <section className="card">
      <header className="mb-3">
        <h2 className="text-sm font-semibold">Pace this week</h2>
        <p className="text-xs text-ink-400">
          Target-to-date vs actual, with a sparkline of completed minutes per
          day. Marks override slot tallies when set.
        </p>
      </header>
      <ul className="flex flex-col gap-2">
        {rollups.map((r) => {
          const goal = goalById.get(r.goalId);
          if (!goal) return null;
          const color = goalColorFromKey(r.goalId);
          return (
            <li
              key={r.goalId}
              className="rounded-md border border-ink-200 bg-white p-3 dark:border-ink-600 dark:bg-ink-900/60"
              style={{ borderLeftColor: color, borderLeftWidth: 4 }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium" style={{ color }}>
                  {goal.title}
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_BG[r.status]}`}
                >
                  {STATUS_LABEL[r.status]}
                  {r.status === "behind" && r.deltaMinutes < 0
                    ? ` ${formatMinutes(-r.deltaMinutes)}`
                    : ""}
                  {r.status === "ahead" && r.deltaMinutes > 0
                    ? ` ${formatMinutes(r.deltaMinutes)}`
                    : ""}
                </span>
              </div>
              <div className="mt-1 text-xs text-ink-400">
                {formatMinutes(r.effectiveActualMinutes)} of{" "}
                {formatMinutes(r.targetMinutes)} (
                {formatMinutes(r.targetToDate)} expected by now)
              </div>
              <Sparkline byDay={r.byDay} weekDates={weekDates} color={color} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Sparkline({
  byDay,
  weekDates,
  color
}: {
  byDay: number[];
  weekDates: string[];
  color: string;
}) {
  const max = Math.max(15, ...byDay);
  const labels = ["M", "T", "W", "T", "F", "S", "S"];
  return (
    <div className="mt-2 grid grid-cols-7 gap-1">
      {byDay.map((minutes, idx) => {
        const height = Math.round((minutes / max) * 32);
        return (
          <div
            key={`${weekDates[idx] ?? idx}`}
            className="flex flex-col items-center gap-1"
          >
            <div
              className="w-full rounded-t bg-ink-100 dark:bg-ink-900/40"
              style={{ height: 32 }}
            >
              <div
                className="rounded-t"
                style={{
                  height,
                  backgroundColor: color,
                  marginTop: 32 - height,
                  opacity: minutes > 0 ? 0.85 : 0.15
                }}
              />
            </div>
            <span className="text-[10px] text-ink-400">{labels[idx]}</span>
          </div>
        );
      })}
    </div>
  );
}

function AutomatedCatchUpSummary({
  allocatorFloors,
  goalById
}: {
  allocatorFloors: Record<string, number>;
  goalById: Map<string, WeeklyGoal>;
}) {
  const entries = Object.entries(allocatorFloors).filter(([, m]) => m > 0);
  return (
    <section className="card">
      <header className="mb-3">
        <h2 className="text-sm font-semibold">Catch-up</h2>
        <p className="mt-1 text-xs text-ink-400">
          Floors are calculated from your day sheet vs a baseline allocation (same logic as pace
          recommendations). The Perfect Week allocator applies these extra weekly minimums—no Apply
          needed.
        </p>
      </header>
      {entries.length === 0 ? (
        <p className="text-xs text-ink-400">
          No extra catch-up floors this week. Goals that fall behind will gain floors here as you
          log time.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map(([goalId, minutes]) => {
            const goal = goalById.get(goalId);
            if (!goal) return null;
            const color = goalColorFromKey(goalId);
            return (
              <li
                key={goalId}
                className="rounded-md border border-ink-200 bg-white p-3 dark:border-ink-600 dark:bg-ink-900/60"
                style={{ borderLeftColor: color, borderLeftWidth: 4 }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium" style={{ color }}>
                    {goal.title}
                  </div>
                  <span className="text-xs text-ink-600 dark:text-ink-200">
                    +{minutes}m floor
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-ink-400">
        To set floors yourself from this screen, switch to{" "}
        <Link
          href="/dashboard/energy#scheduling-constraints"
          className="text-accent hover:underline"
        >
          manual catch-up
        </Link>{" "}
        under Scheduling rules on Planning.
      </p>
    </section>
  );
}

function CatchUpPlanner({
  rollups,
  goalById,
  edits,
  applied,
  appliedAt,
  onChange,
  onSubmit,
  onReset
}: {
  rollups: GoalRollup[];
  goalById: Map<string, WeeklyGoal>;
  edits: Record<string, number>;
  applied: Record<string, number>;
  appliedAt?: number;
  onChange: (goalId: string, minutes: number) => void;
  onSubmit: () => void;
  onReset: () => void;
}) {
  const candidates = rollups.filter(
    (r) => r.status === "behind" || r.catchUpRecommendation > 0
  );
  const hasActive = Object.keys(applied).length > 0;
  const isDirty = JSON.stringify(edits) !== JSON.stringify(applied);

  return (
    <section className="card">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Catch-up planner</h2>
          <p className="text-xs text-ink-400">
            Add minutes to a goal&apos;s weekly floor for the rest of the week.
            The Perfect Week allocator will rebalance.
          </p>
        </div>
        {hasActive && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
            Catch-up active{" "}
            {appliedAt
              ? `· ${new Date(appliedAt).toLocaleDateString()}`
              : ""}
          </span>
        )}
      </header>
      {candidates.length === 0 ? (
        <p className="text-xs text-ink-400">
          Nothing flagged yet. Behind-pace goals will show up here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {candidates.map((r) => {
            const goal = goalById.get(r.goalId);
            if (!goal) return null;
            const color = goalColorFromKey(r.goalId);
            const value = edits[r.goalId] ?? 0;
            return (
              <li
                key={r.goalId}
                className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-2 rounded-md border border-ink-200 p-2 dark:border-ink-600"
                style={{ borderLeftColor: color, borderLeftWidth: 4 }}
              >
                <div>
                  <div className="text-sm font-medium" style={{ color }}>
                    {goal.title}
                  </div>
                  <div className="text-xs text-ink-400">
                    Suggested catch-up: {formatMinutes(r.catchUpRecommendation)}
                    {r.deltaMinutes < 0 && (
                      <> · behind {formatMinutes(-r.deltaMinutes)}</>
                    )}
                  </div>
                </div>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="number"
                    step={15}
                    className="field text-xs"
                    value={value || ""}
                    onChange={(e) =>
                      onChange(
                        r.goalId,
                        e.target.value === "" ? 0 : Number(e.target.value)
                      )
                    }
                  />
                  <span className="text-ink-400">min</span>
                </label>
                <button
                  type="button"
                  className="text-xs text-ink-400 hover:text-ink-900 dark:hover:text-ink-100"
                  onClick={() => onChange(r.goalId, 0)}
                >
                  reset
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary text-xs"
          onClick={onSubmit}
          disabled={!isDirty && !hasActive}
        >
          Apply catch-up
        </button>
        {hasActive && (
          <button type="button" className="btn-secondary text-xs" onClick={onReset}>
            Clear
          </button>
        )}
      </div>
    </section>
  );
}

function BurchardWeeklyCard({
  questions,
  onChange,
  highlights
}: {
  questions: BurchardWeeklyQuestions;
  onChange: (next: BurchardWeeklyQuestions) => void;
  highlights: WeeklyReviewClientProps["dailyHighlights"];
}) {
  const wins = questions.biggestWins ?? [];
  const lessons = questions.lessons ?? [];
  return (
    <section className="card">
      <header className="mb-2">
        <h2 className="text-sm font-semibold">Week review</h2>
        <p className="text-xs text-ink-400">
          Burchard&apos;s weekly review prompts. Daily entries are listed below
          each prompt as raw material.
        </p>
      </header>

      <PromptList
        label="Biggest wins"
        values={wins}
        maxItems={5}
        suggestions={highlights.wins.map((w) => `${w.date}: ${w.text}`)}
        onChange={(next) => onChange({ ...questions, biggestWins: next })}
      />

      <PromptList
        label="Lessons learned"
        values={lessons}
        maxItems={5}
        suggestions={highlights.improvements.map((w) => `${w.date}: ${w.text}`)}
        onChange={(next) => onChange({ ...questions, lessons: next })}
      />

      <PromptTextArea
        label="Who did I affect — positively or otherwise?"
        value={questions.affectedOthers ?? ""}
        onChange={(v) => onChange({ ...questions, affectedOthers: v })}
      />
      <PromptTextArea
        label="Next week's focus"
        value={questions.nextWeekFocus ?? ""}
        suggestions={highlights.intentions.map((w) => `${w.date}: ${w.text}`)}
        onChange={(v) => onChange({ ...questions, nextWeekFocus: v })}
      />
      <PromptTextArea
        label="What gave me energy?"
        value={questions.energySources ?? ""}
        onChange={(v) => onChange({ ...questions, energySources: v })}
      />
      <PromptTextArea
        label="What drained me?"
        value={questions.energyDrains ?? ""}
        onChange={(v) => onChange({ ...questions, energyDrains: v })}
      />
    </section>
  );
}

function PromptList({
  label,
  values,
  maxItems,
  suggestions,
  onChange
}: {
  label: string;
  values: string[];
  maxItems: number;
  suggestions?: string[];
  onChange: (next: string[]) => void;
}) {
  const slots = Array.from({ length: maxItems }, (_, i) => values[i] ?? "");
  return (
    <div className="mb-3 flex flex-col gap-1 text-xs">
      <span className="text-ink-600 dark:text-ink-200">{label}</span>
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
      {suggestions && suggestions.length > 0 && (
        <details className="mt-1 text-ink-400">
          <summary className="cursor-pointer">From your daily notes…</summary>
          <ul className="mt-1 list-disc pl-5">
            {suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function PromptTextArea({
  label,
  value,
  suggestions,
  onChange
}: {
  label: string;
  value: string;
  suggestions?: string[];
  onChange: (next: string) => void;
}) {
  return (
    <div className="mb-3 flex flex-col gap-1 text-xs">
      <span className="text-ink-600 dark:text-ink-200">{label}</span>
      <textarea
        rows={3}
        className="field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {suggestions && suggestions.length > 0 && (
        <details className="text-ink-400">
          <summary className="cursor-pointer">From your daily notes…</summary>
          <ul className="mt-1 list-disc pl-5">
            {suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function EnergySummaryCard({
  totals,
  drainCandidates
}: {
  totals: Record<EnergyState, number>;
  drainCandidates: Array<{ key: string; label: string; minutes: number }>;
}) {
  const total =
    (totals.energise ?? 0) + (totals.neutral ?? 0) + (totals.drain ?? 0);
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  return (
    <section className="card">
      <header className="mb-2">
        <h2 className="text-sm font-semibold">Energy summary</h2>
        <p className="text-xs text-ink-400">
          Mix of energising vs draining time across your logged slots, plus the
          biggest drains to consider buying back.
        </p>
      </header>
      <ul className="flex flex-wrap gap-2 text-xs">
        <li className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
          Energise: <strong>{formatMinutes(totals.energise)}</strong> ({pct(totals.energise)}%)
        </li>
        <li className="rounded-full bg-ink-100 px-2 py-1 dark:bg-ink-900/40">
          Neutral: <strong>{formatMinutes(totals.neutral)}</strong> ({pct(totals.neutral)}%)
        </li>
        <li className="rounded-full bg-amber-100 px-2 py-1 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          Drain: <strong>{formatMinutes(totals.drain)}</strong> ({pct(totals.drain)}%)
        </li>
      </ul>
      {drainCandidates.length > 0 && (
        <div className="mt-3">
          <div className="text-xs uppercase tracking-wide text-ink-400">
            Top drains (candidates to buy back)
          </div>
          <ul className="mt-1 list-decimal pl-5 text-xs">
            {drainCandidates.map((c) => (
              <li key={c.key}>
                {c.label} — <strong>{formatMinutes(c.minutes)}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
