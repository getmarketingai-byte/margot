"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type {
  AttentionMode,
  EnergyPolarity,
  WeeklyGoal,
  WorkLayer
} from "@calendar-automations/schema";
import {
  ATTENTION_MODE_LABELS,
  ENERGY_POLARITY_LABELS,
  WORK_LAYER_LABELS,
  chipsForGoal
} from "../plan/goal-helpers";
import { goalColorFromKey } from "@/lib/goal-colors";
import { updateGoal } from "../plan/actions";

interface WheelOption {
  id: string;
  label: string;
}

interface EnergyBoardClientProps {
  initialGoals: WeeklyGoal[];
  wheelAreas: WheelOption[];
}

/** Default-aware accessors so legacy goals without the new fields render cleanly. */
function readPolarity(goal: WeeklyGoal): EnergyPolarity {
  return goal.energyPolarity ?? "neutral";
}
function readAttention(goal: WeeklyGoal): AttentionMode {
  return goal.attentionMode ?? "unspecified";
}
function readWorkLayer(goal: WeeklyGoal): WorkLayer {
  return goal.workLayer ?? "unspecified";
}

const POLARITY_COLUMNS: ReadonlyArray<{
  id: EnergyPolarity;
  title: string;
  hint: string;
}> = [
  {
    id: "energise",
    title: "Energises",
    hint: "Goals that recharge you. Anchor demanding focus around them."
  },
  {
    id: "neutral",
    title: "Neutral",
    hint: "Default bucket. Re-classify as you learn what each goal feels like."
  },
  {
    id: "drain",
    title: "Drains",
    hint: "Costly goals. Avoid stacking them and pair with recovery."
  }
];

const POLARITY_OPTIONS: ReadonlyArray<{ id: EnergyPolarity; label: string }> = [
  { id: "energise", label: "Energise" },
  { id: "neutral", label: "Neutral" },
  { id: "drain", label: "Drain" }
];

const ATTENTION_OPTIONS: ReadonlyArray<{ id: AttentionMode; label: string }> = [
  { id: "hyperfocus", label: "Hyper focus" },
  { id: "hyperaware", label: "Hyper awareness" },
  { id: "unspecified", label: "Any" }
];

const WORK_LAYER_OPTIONS: ReadonlyArray<{ id: WorkLayer; label: string }> = [
  { id: "needle-mover", label: "Needle mover" },
  { id: "execution", label: "Execution" },
  { id: "ops", label: "Ops / future" },
  { id: "play", label: "Play" },
  { id: "unspecified", label: "Any" }
];

export function EnergyBoardClient({ initialGoals, wheelAreas }: EnergyBoardClientProps) {
  const [goals, setGoals] = useState<WeeklyGoal[]>(initialGoals);
  const [, startTransition] = useTransition();

  const lastSeenSignature = useRef<string>("");
  useEffect(() => {
    const sig = initialGoals.map((g) => g.id).join("|");
    if (sig !== lastSeenSignature.current) {
      lastSeenSignature.current = sig;
      setGoals(initialGoals);
    }
  }, [initialGoals]);

  const wheelLabel = useMemo(
    () => (id: string) => wheelAreas.find((a) => a.id === id)?.label ?? id,
    [wheelAreas]
  );

  const grouped = useMemo(() => {
    const out: Record<EnergyPolarity, WeeklyGoal[]> = {
      energise: [],
      neutral: [],
      drain: []
    };
    for (const g of goals) out[readPolarity(g)].push(g);
    return out;
  }, [goals]);

  const summary = useMemo(() => {
    const layerCounts: Record<WorkLayer, number> = {
      "needle-mover": 0,
      execution: 0,
      ops: 0,
      play: 0,
      unspecified: 0
    };
    const attentionCounts: Record<AttentionMode, number> = {
      hyperfocus: 0,
      hyperaware: 0,
      unspecified: 0
    };
    for (const g of goals) {
      layerCounts[readWorkLayer(g)] += 1;
      attentionCounts[readAttention(g)] += 1;
    }
    return { layerCounts, attentionCounts };
  }, [goals]);

  const persist = (id: string, next: WeeklyGoal) => {
    setGoals((prev) => prev.map((g) => (g.id === id ? next : g)));
    startTransition(async () => {
      try {
        const { id: _id, ...payload } = next;
        void _id;
        await updateGoal(id, payload);
      } catch (err) {
        console.error("updateGoal (energy) failed", err);
      }
    });
  };

  const setPolarity = (goal: WeeklyGoal, polarity: EnergyPolarity) => {
    if (readPolarity(goal) === polarity) return;
    persist(goal.id, { ...goal, energyPolarity: polarity });
  };
  const setAttention = (goal: WeeklyGoal, mode: AttentionMode) => {
    if (readAttention(goal) === mode) return;
    persist(goal.id, { ...goal, attentionMode: mode });
  };
  const setWorkLayer = (goal: WeeklyGoal, layer: WorkLayer) => {
    if (readWorkLayer(goal) === layer) return;
    persist(goal.id, { ...goal, workLayer: layer });
  };

  if (goals.length === 0) {
    return (
      <section className="card">
        <h2 className="text-sm font-semibold">No goals yet</h2>
        <p className="mt-1 text-xs text-ink-400">
          Add goals on the Perfect Week page first; once you have a list, come back here to
          tag how each one affects your energy.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <BoardSummary
        layerCounts={summary.layerCounts}
        attentionCounts={summary.attentionCounts}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {POLARITY_COLUMNS.map((column) => {
          const items = grouped[column.id];
          return (
            <section
              key={column.id}
              className="flex flex-col gap-3 rounded-lg border border-ink-200 bg-ink-50/50 p-3 dark:border-ink-600 dark:bg-ink-900/40"
              aria-label={`${column.title} goals`}
            >
              <header>
                <h2 className="text-sm font-semibold">{column.title}</h2>
                <p className="mt-0.5 text-[11px] text-ink-400">{column.hint}</p>
                <p className="mt-0.5 text-[11px] text-ink-400">
                  {items.length} {items.length === 1 ? "goal" : "goals"}
                </p>
              </header>
              {items.length === 0 ? (
                <p className="rounded-md border border-dashed border-ink-200 px-3 py-6 text-center text-xs text-ink-400 dark:border-ink-600">
                  Drop goals here by selecting "{column.title.toLowerCase()}" on a card.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {items.map((goal) => (
                    <EnergyGoalCard
                      key={goal.id}
                      goal={goal}
                      wheelLabel={wheelLabel}
                      onSetPolarity={(p) => setPolarity(goal, p)}
                      onSetAttention={(m) => setAttention(goal, m)}
                      onSetWorkLayer={(l) => setWorkLayer(goal, l)}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BoardSummary({
  layerCounts,
  attentionCounts
}: {
  layerCounts: Record<WorkLayer, number>;
  attentionCounts: Record<AttentionMode, number>;
}) {
  return (
    <div className="card grid gap-4 sm:grid-cols-2">
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-400">By work layer</div>
        <ul className="mt-2 flex flex-wrap gap-2 text-xs">
          {WORK_LAYER_OPTIONS.filter((opt) => opt.id !== "unspecified").map((opt) => (
            <li
              key={opt.id}
              className="rounded-full bg-ink-100 px-2 py-1 dark:bg-ink-900/40"
            >
              {opt.label}: <strong>{layerCounts[opt.id]}</strong>
            </li>
          ))}
          {layerCounts.unspecified > 0 && (
            <li className="rounded-full bg-ink-100 px-2 py-1 text-ink-400 dark:bg-ink-900/40">
              Untagged: <strong>{layerCounts.unspecified}</strong>
            </li>
          )}
        </ul>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-ink-400">By attention mode</div>
        <ul className="mt-2 flex flex-wrap gap-2 text-xs">
          {ATTENTION_OPTIONS.filter((opt) => opt.id !== "unspecified").map((opt) => (
            <li
              key={opt.id}
              className="rounded-full bg-ink-100 px-2 py-1 dark:bg-ink-900/40"
            >
              {opt.label}: <strong>{attentionCounts[opt.id]}</strong>
            </li>
          ))}
          {attentionCounts.unspecified > 0 && (
            <li className="rounded-full bg-ink-100 px-2 py-1 text-ink-400 dark:bg-ink-900/40">
              Untagged: <strong>{attentionCounts.unspecified}</strong>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function EnergyGoalCard({
  goal,
  wheelLabel,
  onSetPolarity,
  onSetAttention,
  onSetWorkLayer
}: {
  goal: WeeklyGoal;
  wheelLabel: (id: string) => string;
  onSetPolarity: (p: EnergyPolarity) => void;
  onSetAttention: (m: AttentionMode) => void;
  onSetWorkLayer: (l: WorkLayer) => void;
}) {
  const color = goalColorFromKey(goal.id || goal.title);
  const polarity = readPolarity(goal);
  const attention = readAttention(goal);
  const layer = readWorkLayer(goal);
  const contextChips = chipsForGoal(goal, wheelLabel).filter(
    (c) => c.key !== "polarity" && c.key !== "attention" && c.key !== "layer"
  );

  return (
    <li
      className="rounded-md border border-ink-200 bg-white p-3 dark:border-ink-600 dark:bg-ink-900/60"
      style={{ borderLeftColor: color, borderLeftWidth: 4 }}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1">
          <div className="text-sm font-medium" style={{ color }}>
            {goal.title}
          </div>
          {contextChips.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {contextChips.map((chip) => (
                <span
                  key={chip.key}
                  className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] text-ink-600 dark:bg-ink-900/40 dark:text-ink-200"
                >
                  {chip.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <SegmentedControl
          ariaLabel={`Energy polarity for ${goal.title}`}
          options={POLARITY_OPTIONS}
          value={polarity}
          valueLabel={ENERGY_POLARITY_LABELS[polarity]}
          onChange={onSetPolarity}
        />
        <SegmentedControl
          ariaLabel={`Attention mode for ${goal.title}`}
          options={ATTENTION_OPTIONS}
          value={attention}
          valueLabel={ATTENTION_MODE_LABELS[attention]}
          onChange={onSetAttention}
        />
        <SegmentedControl
          ariaLabel={`Work layer for ${goal.title}`}
          options={WORK_LAYER_OPTIONS}
          value={layer}
          valueLabel={WORK_LAYER_LABELS[layer]}
          onChange={onSetWorkLayer}
        />
      </div>
    </li>
  );
}

function SegmentedControl<T extends string>({
  ariaLabel,
  options,
  value,
  valueLabel,
  onChange
}: {
  ariaLabel: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  valueLabel: string;
  onChange: (next: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex flex-wrap gap-1"
      title={valueLabel}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.id)}
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
    </div>
  );
}
