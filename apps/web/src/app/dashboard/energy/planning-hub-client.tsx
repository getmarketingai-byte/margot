"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode
} from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import { restrictToParentElement } from "@dnd-kit/modifiers";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type {
  AttentionMode,
  CommitmentLevel,
  EnergyPolarity,
  Hp6HabitKey,
  PlacementSignalKey,
  PpfHorizonKey,
  PpfPillarKey,
  VisionSettings,
  WeeklyGoal,
  WeeklyIntent,
  WorkLayer
} from "@calendar-automations/schema";
import { goalColorFromKey } from "@/lib/goal-colors";
import { patchGoal } from "../plan/actions";

const HP6_LABELS: Record<Hp6HabitKey, string> = {
  clarity: "Clarity",
  energy: "Energy",
  necessity: "Necessity",
  productivity: "Productivity",
  influence: "Influence",
  courage: "Courage"
};

const PPF_LABELS: Record<PpfPillarKey, string> = {
  personal: "Personal",
  professional: "Professional",
  financial: "Financial"
};

const PPF_HORIZON_LABELS: Record<PpfHorizonKey, string> = {
  y1: "1 year",
  y3: "3 years",
  y5: "5 years",
  unspecified: "No horizon"
};

const COMMITMENT_LABELS: Record<CommitmentLevel, string> = {
  non_negotiable: "Non-negotiable",
  committed: "Committed",
  nice_to_have: "Nice to have"
};

const PLACEMENT_SIGNAL_LABELS: Record<PlacementSignalKey, string> = {
  energyMode: "Energy mode (deep / scanning)",
  attentionMode: "Attention (hyper-focus / aware)",
  workLayer: "Work layer (needle, exec, ops, play)",
  energyPolarity: "Polarity (energise / drain)"
};

type FrameworkKey =
  | "commitment"
  | "polarity"
  | "attention"
  | "workLayer"
  | "wheel"
  | "ppfPillar"
  | "ppfHorizon"
  | "hp6";

interface BoardColumn {
  id: string;
  title: string;
}

interface BoardConfig {
  key: FrameworkKey;
  title: string;
  description: string;
  /** When false, the board is disabled with a hint to enable in Constraints. */
  enabled: boolean;
  /** Hint text shown when disabled. */
  disabledHint?: string;
  columns: BoardColumn[];
  columnOf: (goal: WeeklyGoal) => string;
  patchFor: (columnId: string) => Partial<Omit<WeeklyGoal, "id">>;
}

interface PlanningHubClientProps {
  initialGoals: WeeklyGoal[];
  initialIntent: WeeklyIntent;
  initialVision: VisionSettings;
  initialPlacementOrder: readonly PlacementSignalKey[];
  wheelAreas: ReadonlyArray<{ id: string; label: string }>;
  wheelEnabled: boolean;
  ppfEnabled: boolean;
  hppEnabled: boolean;
  saveVision: (input: VisionSettings) => Promise<void>;
  savePlacementOrder: (order: readonly PlacementSignalKey[]) => Promise<void>;
  saveWeeklyIntent: (input: WeeklyIntent) => Promise<void>;
}

/**
 * Top-level planning hub. Composes (in order down the page):
 *
 *   1. Weekly intentions card — short reflection prompts that anchor the week.
 *   2. Long-horizon vision — PPF-aligned text persisted on user settings.
 *   3. Framework picker — toggles which kanban board is visible right now.
 *   4. Active board — drag goals between columns to set the framework tag.
 *   5. Placement tie-break — rank the four placement signals.
 */
export function PlanningHubClient(props: PlanningHubClientProps) {
  const {
    initialGoals,
    initialIntent,
    initialVision,
    initialPlacementOrder,
    wheelAreas,
    wheelEnabled,
    ppfEnabled,
    hppEnabled,
    saveVision,
    savePlacementOrder,
    saveWeeklyIntent
  } = props;
  const [goals, setGoals] = useState<WeeklyGoal[]>(initialGoals);
  const lastSeenSig = useRef<string>("");
  useEffect(() => {
    const sig = initialGoals.map((g) => `${g.id}:${g.title}`).join("|");
    if (sig !== lastSeenSig.current) {
      lastSeenSig.current = sig;
      setGoals(initialGoals);
    }
  }, [initialGoals]);

  const wheelLabel = useMemo(
    () => (id: string) => wheelAreas.find((a) => a.id === id)?.label ?? id,
    [wheelAreas]
  );

  const boards = useMemo<BoardConfig[]>(
    () =>
      buildBoardRegistry({ wheelAreas, wheelEnabled, ppfEnabled, hppEnabled }),
    [wheelAreas, wheelEnabled, ppfEnabled, hppEnabled]
  );

  const [activeBoardKey, setActiveBoardKey] = useState<FrameworkKey>("commitment");
  const activeBoard = boards.find((b) => b.key === activeBoardKey) ?? boards[0]!;

  const handlePatch = (goalId: string, patch: Partial<Omit<WeeklyGoal, "id">>) => {
    setGoals((prev) =>
      prev.map((g) => (g.id === goalId ? ({ ...g, ...patch } as WeeklyGoal) : g))
    );
    void patchGoal(goalId, patch).catch((err) => {
      console.error("patchGoal failed", err);
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <WeeklyIntentCard
        initial={initialIntent}
        save={saveWeeklyIntent}
        hppEnabled={hppEnabled}
      />

      <VisionCard initial={initialVision} save={saveVision} />

      <FrameworkPicker
        boards={boards}
        activeKey={activeBoard.key}
        onChange={setActiveBoardKey}
      />

      {goals.length === 0 ? (
        <EmptyGoalsCallout />
      ) : (
        <FrameworkBoard
          board={activeBoard}
          goals={goals}
          wheelLabel={wheelLabel}
          onPatch={handlePatch}
        />
      )}

      <PlacementPriorityCard
        initialOrder={initialPlacementOrder}
        save={savePlacementOrder}
      />
    </div>
  );
}

/* ─────────────────────────── Weekly intent card ──────────────────────────── */

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
    hint: "1–3 things that would make this week a win.",
    rows: 3
  },
  {
    key: "mustWins",
    label: "Must-wins vs stretch",
    hint: "What absolutely has to land — and what would be a bonus.",
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

function WeeklyIntentCard({
  initial,
  save,
  hppEnabled
}: {
  initial: WeeklyIntent;
  save: (input: WeeklyIntent) => Promise<void>;
  hppEnabled: boolean;
}) {
  const [intent, setIntent] = useState<WeeklyIntent>(initial);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync from the server when an external change happens.
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

  return (
    <section className="card flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-start justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <div>
          <h2 className="text-sm font-semibold">This week&apos;s intentions</h2>
          <p className="text-xs text-ink-400">
            Short prompts to anchor what matters before scheduling. Inspired by high-performance
            weekly reviews.
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
          {hppEnabled && (
            <fieldset className="flex flex-col gap-2 rounded-md border border-ink-200 p-2 dark:border-ink-600">
              <legend className="px-1 text-xs font-medium">HP6 focus this week</legend>
              <p className="text-[11px] text-ink-400">
                Optional — pick the habits you want to double down on. The HP6 board below uses
                the same six options.
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
          )}
        </div>
      )}
    </section>
  );
}

/* ─────────────────────────── Vision card ─────────────────────────────────── */

const VISION_FIELDS: ReadonlyArray<{
  key: keyof VisionSettings;
  label: string;
  hint: string;
}> = [
  {
    key: "northStar",
    label: "North star",
    hint: "One paragraph that captures what this whole life points at."
  },
  {
    key: "personal",
    label: "Personal vision",
    hint: "Health, relationships, identity — the personal pillar of PPF."
  },
  {
    key: "professional",
    label: "Professional vision",
    hint: "Career, mission, the work you want to be known for."
  },
  {
    key: "financial",
    label: "Financial vision",
    hint: "Money, freedom, security — what numbers does the future need?"
  }
];

function VisionCard({
  initial,
  save
}: {
  initial: VisionSettings;
  save: (input: VisionSettings) => Promise<void>;
}) {
  const [vision, setVision] = useState<VisionSettings>(initial);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const externalSig = useMemo(() => JSON.stringify(initial), [initial]);
  useEffect(() => {
    setVision(initial);
  }, [externalSig, initial]);

  const updateField = (key: keyof VisionSettings, value: string) => {
    const next = { ...vision, [key]: value };
    setVision(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      startTransition(async () => {
        try {
          await save(next);
        } catch (err) {
          console.error("saveVision failed", err);
        }
      });
    }, 400);
  };

  const filledCount = VISION_FIELDS.filter(
    (f) => ((vision[f.key] ?? "") as string).trim().length > 0
  ).length;

  return (
    <section className="card flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-start justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <div>
          <h2 className="text-sm font-semibold">Long-horizon vision</h2>
          <p className="text-xs text-ink-400">
            Optional. Persists across weeks — Personal / Professional / Financial buckets to
            match the PPF framework.
          </p>
        </div>
        <span className="shrink-0 text-xs text-ink-400">
          {filledCount === 0 ? (open ? "Tap to collapse" : "Tap to fill") : `${filledCount} filled`}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-ink-200 pt-3 dark:border-ink-600">
          {VISION_FIELDS.map((field) => (
            <label key={field.key} className="flex flex-col gap-1 text-xs">
              <span className="font-medium">{field.label}</span>
              <span className="text-[11px] text-ink-400">{field.hint}</span>
              <textarea
                rows={3}
                className="field"
                value={(vision[field.key] as string | undefined) ?? ""}
                onChange={(e) => updateField(field.key, e.target.value)}
              />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

/* ─────────────────────────── Framework picker ────────────────────────────── */

function FrameworkPicker({
  boards,
  activeKey,
  onChange
}: {
  boards: ReadonlyArray<BoardConfig>;
  activeKey: FrameworkKey;
  onChange: (key: FrameworkKey) => void;
}) {
  return (
    <nav
      aria-label="Framework boards"
      className="card flex flex-col gap-2"
    >
      <div>
        <h2 className="text-sm font-semibold">Framework boards</h2>
        <p className="text-xs text-ink-400">
          One board per framework. Drag a goal between columns to update its tag — disabled
          frameworks need to be turned on in{" "}
          <a className="underline" href="/dashboard/constraints">
            Constraints
          </a>
          .
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {boards.map((board) => {
          const active = board.key === activeKey;
          const baseClasses =
            "rounded-full border px-2.5 py-1 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";
          if (!board.enabled) {
            return (
              <button
                key={board.key}
                type="button"
                onClick={() => onChange(board.key)}
                aria-pressed={active}
                title={board.disabledHint}
                className={`${baseClasses} border-dashed border-ink-200 text-ink-400 dark:border-ink-600`}
              >
                {board.title}
              </button>
            );
          }
          return (
            <button
              key={board.key}
              type="button"
              onClick={() => onChange(board.key)}
              aria-pressed={active}
              className={`${baseClasses} ${
                active
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-ink-200 text-ink-600 hover:border-accent/40 dark:border-ink-600 dark:text-ink-200"
              }`}
            >
              {board.title}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function EmptyGoalsCallout() {
  return (
    <section className="card">
      <h2 className="text-sm font-semibold">No goals yet</h2>
      <p className="mt-1 text-xs text-ink-400">
        Add your weekly goals on{" "}
        <a className="underline" href="/dashboard/plan">
          Perfect Week
        </a>
        . Once you have a list, the framework boards below let you classify each one.
      </p>
    </section>
  );
}

/* ─────────────────────────── Framework board ─────────────────────────────── */

interface FrameworkBoardProps {
  board: BoardConfig;
  goals: WeeklyGoal[];
  wheelLabel: (id: string) => string;
  onPatch: (goalId: string, patch: Partial<Omit<WeeklyGoal, "id">>) => void;
}

function FrameworkBoard({ board, goals, wheelLabel, onPatch }: FrameworkBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const grouped = useMemo(() => {
    const map = new Map<string, WeeklyGoal[]>();
    for (const col of board.columns) map.set(col.id, []);
    for (const g of goals) {
      const colId = board.columnOf(g);
      const bucket = map.get(colId) ?? [];
      bucket.push(g);
      map.set(colId, bucket);
    }
    return map;
  }, [board, goals]);

  const onDragStart = (e: DragStartEvent) => setDraggingId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setDraggingId(null);
    const goalId = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return;
    if (board.columnOf(goal) === overId) return;
    onPatch(goalId, board.patchFor(overId));
  };

  if (!board.enabled) {
    return (
      <section className="card">
        <h2 className="text-sm font-semibold">{board.title}</h2>
        <p className="mt-1 text-xs text-ink-400">{board.disabledHint}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold">{board.title}</h2>
        <p className="text-xs text-ink-400">{board.description}</p>
      </div>

      <DndContext
        sensors={sensors}
        modifiers={[restrictToParentElement]}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
          {board.columns.map((column) => {
            const items = grouped.get(column.id) ?? [];
            return (
              <BoardColumnDroppable
                key={column.id}
                column={column}
                items={items}
                wheelLabel={wheelLabel}
                draggingId={draggingId}
              />
            );
          })}
        </div>
      </DndContext>
    </section>
  );
}

function BoardColumnDroppable({
  column,
  items,
  wheelLabel,
  draggingId
}: {
  column: BoardColumn;
  items: WeeklyGoal[];
  wheelLabel: (id: string) => string;
  draggingId: string | null;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: column.id });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-64 shrink-0 flex-col gap-2 rounded-lg border bg-ink-50/40 p-3 dark:bg-ink-900/30 ${
        isOver
          ? "border-accent shadow-[inset_0_0_0_2px] shadow-accent/30"
          : "border-ink-200 dark:border-ink-600"
      }`}
      aria-label={`${column.title} column`}
    >
      <header className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-300">
          {column.title}
        </h3>
        <span className="text-[11px] text-ink-400">{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-ink-200 px-2 py-4 text-center text-[11px] text-ink-400 dark:border-ink-600">
          Drop goals here
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((goal) => (
            <li key={goal.id}>
              <BoardGoalCard
                goal={goal}
                wheelLabel={wheelLabel}
                isGhost={draggingId === goal.id}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BoardGoalCard({
  goal,
  wheelLabel,
  isGhost
}: {
  goal: WeeklyGoal;
  wheelLabel: (id: string) => string;
  isGhost: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: goal.id });
  const color = goalColorFromKey(goal.id || goal.title);
  const dy = transform?.y ?? 0;
  const dx = transform?.x ?? 0;
  const style = transform
    ? { transform: `translate3d(${dx}px, ${dy}px, 0)` }
    : undefined;
  const tags: string[] = [];
  if (goal.commitmentLevel && goal.commitmentLevel !== "committed") {
    tags.push(COMMITMENT_LABELS[goal.commitmentLevel]);
  }
  if (goal.wheelAreaId) tags.push(wheelLabel(goal.wheelAreaId));
  if (goal.ppfPillar) tags.push(PPF_LABELS[goal.ppfPillar]);
  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        borderLeftColor: color,
        borderLeftWidth: 4,
        opacity: isGhost ? 0.4 : 1
      }}
      className="cursor-grab rounded-md border border-ink-200 bg-white p-2 text-xs shadow-sm transition hover:shadow-md active:cursor-grabbing dark:border-ink-600 dark:bg-ink-900/70"
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium" style={{ color }}>
            {goal.title}
          </div>
          {tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] text-ink-600 dark:bg-ink-900/40 dark:text-ink-200"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Board registry ──────────────────────────────── */

function buildBoardRegistry({
  wheelAreas,
  wheelEnabled,
  ppfEnabled,
  hppEnabled
}: {
  wheelAreas: ReadonlyArray<{ id: string; label: string }>;
  wheelEnabled: boolean;
  ppfEnabled: boolean;
  hppEnabled: boolean;
}): BoardConfig[] {
  const boards: BoardConfig[] = [
    {
      key: "commitment",
      title: "Commitment",
      description:
        "Non-negotiables get first access to free time. Nice-to-haves only land after the rest fits.",
      enabled: true,
      columns: [
        { id: "non_negotiable", title: COMMITMENT_LABELS.non_negotiable },
        { id: "committed", title: COMMITMENT_LABELS.committed },
        { id: "nice_to_have", title: COMMITMENT_LABELS.nice_to_have }
      ],
      columnOf: (g) => g.commitmentLevel ?? "committed",
      patchFor: (col) => ({ commitmentLevel: col as CommitmentLevel })
    },
    {
      key: "polarity",
      title: "Energy",
      description:
        "Classify which goals recharge you and which drain you. Drains will be spread out, energise blocks may be batched.",
      enabled: true,
      columns: [
        { id: "energise", title: "Energise" },
        { id: "neutral", title: "Neutral" },
        { id: "drain", title: "Drain" }
      ],
      columnOf: (g) => g.energyPolarity ?? "neutral",
      patchFor: (col) => ({ energyPolarity: col as EnergyPolarity })
    },
    {
      key: "attention",
      title: "Attention",
      description:
        "Hyper-focus = deep, single-tasked work; hyper-awareness = scanning, batched, reactive.",
      enabled: true,
      columns: [
        { id: "hyperfocus", title: "Hyper focus" },
        { id: "unspecified", title: "Either" },
        { id: "hyperaware", title: "Hyper aware" }
      ],
      columnOf: (g) => g.attentionMode ?? "unspecified",
      patchFor: (col) => ({ attentionMode: col as AttentionMode })
    },
    {
      key: "workLayer",
      title: "Work layer",
      description:
        "Bustamante-style four layers: needle-mover, execution, ops/future, play.",
      enabled: true,
      columns: [
        { id: "needle-mover", title: "Needle mover" },
        { id: "execution", title: "Execution" },
        { id: "ops", title: "Ops / future" },
        { id: "play", title: "Play" },
        { id: "unspecified", title: "Unsorted" }
      ],
      columnOf: (g) => g.workLayer ?? "unspecified",
      patchFor: (col) => ({ workLayer: col as WorkLayer })
    }
  ];

  boards.push({
    key: "wheel",
    title: "Wheel of Life",
    description:
      "Each life area floor is enforced by the allocator. Drop a goal onto an area to count it toward that floor.",
    enabled: wheelEnabled && wheelAreas.length > 0,
    disabledHint: wheelEnabled
      ? "Add at least one wheel area in Constraints to enable this board."
      : "Enable Wheel of Life in Constraints to use this board.",
    columns: [
      ...wheelAreas.map((a) => ({ id: a.id, title: a.label })),
      { id: "__none__", title: "Unassigned" }
    ],
    columnOf: (g) => g.wheelAreaId ?? "__none__",
    patchFor: (col) => ({ wheelAreaId: col === "__none__" ? undefined : col })
  });

  boards.push({
    key: "ppfPillar",
    title: "PPF pillar",
    description:
      "Personal / Professional / Financial — Natalie Dawson's three buckets. Drives the PPF mix metrics.",
    enabled: ppfEnabled,
    disabledHint: "Enable the PPF mix in Constraints to use this board.",
    columns: [
      { id: "personal", title: "Personal" },
      { id: "professional", title: "Professional" },
      { id: "financial", title: "Financial" },
      { id: "__none__", title: "Unassigned" }
    ],
    columnOf: (g) => g.ppfPillar ?? "__none__",
    patchFor: (col) => ({
      ppfPillar: col === "__none__" ? undefined : (col as PpfPillarKey)
    })
  });

  boards.push({
    key: "ppfHorizon",
    title: "PPF horizon",
    description: "Which time horizon does this goal serve — 1, 3, or 5 years out?",
    enabled: ppfEnabled,
    disabledHint: "Enable the PPF mix in Constraints to use this board.",
    columns: [
      { id: "y1", title: "1 year" },
      { id: "y3", title: "3 years" },
      { id: "y5", title: "5 years" },
      { id: "unspecified", title: "No horizon" }
    ],
    columnOf: (g) => g.ppfHorizon ?? "unspecified",
    patchFor: (col) => ({ ppfHorizon: col as PpfHorizonKey })
  });

  boards.push({
    key: "hp6",
    title: "HP6 habit",
    description:
      "Tag goals against Brendon Burchard's six high-performance habits to hit your monthly minimum touches.",
    enabled: hppEnabled,
    disabledHint: "Enable the HP6 habits in Constraints to use this board.",
    columns: [
      ...HP6_KEYS.map((h) => ({ id: h, title: HP6_LABELS[h] })),
      { id: "__none__", title: "Unassigned" }
    ],
    columnOf: (g) => g.hp6Habit ?? "__none__",
    patchFor: (col) => ({
      hp6Habit: col === "__none__" ? undefined : (col as Hp6HabitKey)
    })
  });

  return boards;
}

/* ─────────────────────────── Placement priority ─────────────────────────── */

const PLACEMENT_KEYS: readonly PlacementSignalKey[] = [
  "energyMode",
  "attentionMode",
  "workLayer",
  "energyPolarity"
];

function PlacementPriorityCard({
  initialOrder,
  save
}: {
  initialOrder: readonly PlacementSignalKey[];
  save: (order: readonly PlacementSignalKey[]) => Promise<void>;
}) {
  const [order, setOrder] = useState<PlacementSignalKey[]>(() => normaliseOrder(initialOrder));
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  useEffect(() => setOrder(normaliseOrder(initialOrder)), [initialOrder]);

  const move = (idx: number, delta: number) => {
    const target = idx + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const [picked] = next.splice(idx, 1);
    if (!picked) return;
    next.splice(target, 0, picked);
    setOrder(next);
    startTransition(async () => {
      try {
        await save(next);
      } catch (err) {
        console.error("savePlacementOrder failed", err);
      }
    });
  };

  return (
    <section className="card flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-start justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <div>
          <h2 className="text-sm font-semibold">Placement tie-breaks</h2>
          <p className="text-xs text-ink-400">
            When a goal&apos;s tags imply different ideal hours, the top-ranked signal wins. Goal
            list order on Perfect Week still decides who gets first pick of free time.
          </p>
        </div>
        <span className="shrink-0 text-xs text-ink-400">
          {open ? "Hide" : "Reorder"}
        </span>
      </button>
      {open && (
        <ol className="mt-1 flex flex-col gap-2 border-t border-ink-200 pt-3 dark:border-ink-600">
          {order.map((key, idx) => (
            <li
              key={key}
              className="flex items-center gap-2 rounded-md border border-ink-200 bg-ink-50/50 p-2 dark:border-ink-600 dark:bg-ink-900/40"
            >
              <span className="w-6 text-center text-xs font-semibold text-ink-400">
                {idx + 1}
              </span>
              <span className="flex-1 text-xs">{PLACEMENT_SIGNAL_LABELS[key]}</span>
              <RankButton title="Move up" onClick={() => move(idx, -1)} disabled={idx === 0}>
                ↑
              </RankButton>
              <RankButton
                title="Move down"
                onClick={() => move(idx, 1)}
                disabled={idx === order.length - 1}
              >
                ↓
              </RankButton>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RankButton({
  children,
  title,
  onClick,
  disabled
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-ink-200 px-2 py-0.5 text-xs hover:border-accent disabled:opacity-30 dark:border-ink-600"
    >
      {children}
    </button>
  );
}

function normaliseOrder(order: readonly PlacementSignalKey[]): PlacementSignalKey[] {
  const seen = new Set<PlacementSignalKey>();
  const next: PlacementSignalKey[] = [];
  for (const key of order) {
    if (PLACEMENT_KEYS.includes(key) && !seen.has(key)) {
      seen.add(key);
      next.push(key);
    }
  }
  for (const key of PLACEMENT_KEYS) {
    if (!seen.has(key)) next.push(key);
  }
  return next;
}
