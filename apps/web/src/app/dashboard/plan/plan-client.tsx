"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent
} from "react";
import type {
  DayOfWeek,
  EnergyMode,
  PpfPillarKey,
  SpecialGoalType,
  WeeklyGoal
} from "@calendar-automations/schema";
import {
  SPECIAL_GOAL_PRESETS,
  STARTER_GOALS,
  chipsForGoal,
  formatMinutes,
  summariseAllocation
} from "./goal-helpers";
import { addGoal, removeGoal, reorderGoals, updateGoal } from "./actions";

type GoalDraft = Omit<WeeklyGoal, "id" | "title">;
type GoalInput = Omit<WeeklyGoal, "id">;

interface WheelOption {
  id: string;
  label: string;
}

interface PlanClientProps {
  initialGoals: WeeklyGoal[];
  freeMinutesThisWeek: number;
  wheelAreas: WheelOption[];
  scheduledByGoal: Record<string, number>;
  effectiveTargetByGoal: Record<string, number>;
}

const DAY_OPTIONS: Array<{ value: DayOfWeek; label: string }> = [
  { value: "monday", label: "Mon" },
  { value: "tuesday", label: "Tue" },
  { value: "wednesday", label: "Wed" },
  { value: "thursday", label: "Thu" },
  { value: "friday", label: "Fri" },
  { value: "saturday", label: "Sat" },
  { value: "sunday", label: "Sun" }
];

function emptyDraft(): GoalDraft {
  return {
    energyMode: "neutral",
    ppfHorizon: "unspecified"
  };
}

function ensureGoalShape(input: GoalInput): GoalInput {
  return {
    ...input,
    energyMode: input.energyMode ?? "neutral",
    ppfHorizon: input.ppfHorizon ?? "unspecified"
  };
}

function applySpecialGoalPreset(current: GoalDraft, type?: SpecialGoalType): GoalDraft {
  const withoutPreset: GoalDraft = {
    ...current,
    specialGoalType: undefined,
    anchor: undefined,
    earliestHour: undefined,
    latestHour: undefined
  };
  if (!type) return withoutPreset;
  const preset = SPECIAL_GOAL_PRESETS.find((p) => p.type === type);
  if (!preset) return withoutPreset;
  return {
    ...withoutPreset,
    ...preset.draft
  };
}

export function PlanClient({
  initialGoals,
  freeMinutesThisWeek,
  wheelAreas,
  scheduledByGoal,
  effectiveTargetByGoal
}: PlanClientProps) {
  const [goals, setGoals] = useState<WeeklyGoal[]>(initialGoals);
  const [, startTransition] = useTransition();

  // Keep local state synced if the server re-renders with different props
  // (e.g. user navigates away and back). We compare by ids+length to avoid
  // stomping in-progress edits when the props are equivalent.
  const lastSeenSignature = useRef<string>("");
  useEffect(() => {
    const sig = initialGoals.map((g) => g.id).join("|");
    if (sig !== lastSeenSignature.current) {
      lastSeenSignature.current = sig;
      setGoals(initialGoals);
    }
  }, [initialGoals]);

  const summary = useMemo(
    () => summariseAllocation(goals, freeMinutesThisWeek),
    [goals, freeMinutesThisWeek]
  );

  const wheelLabel = useCallback(
    (id: string) => wheelAreas.find((a) => a.id === id)?.label ?? id,
    [wheelAreas]
  );

  const handleAdd = (title: string, draft: GoalDraft) => {
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: WeeklyGoal = {
      id: tempId,
      title,
      ...draft,
      energyMode: draft.energyMode ?? "neutral",
      ppfHorizon: draft.ppfHorizon ?? "unspecified"
    };
    setGoals((prev) => [...prev, optimistic]);
    const payload = ensureGoalShape({ title, ...draft });
    startTransition(async () => {
      try {
        const { id } = await addGoal(payload);
        setGoals((prev) => prev.map((g) => (g.id === tempId ? { ...g, id } : g)));
      } catch (err) {
        console.error("addGoal failed", err);
        setGoals((prev) => prev.filter((g) => g.id !== tempId));
      }
    });
  };

  const handleUpdate = (id: string, next: GoalInput) => {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, ...next, id } : g)));
    startTransition(async () => {
      try {
        await updateGoal(id, ensureGoalShape(next));
      } catch (err) {
        console.error("updateGoal failed", err);
      }
    });
  };

  const handleDelete = (id: string) => {
    const snapshot = goals;
    setGoals((prev) => prev.filter((g) => g.id !== id));
    startTransition(async () => {
      try {
        await removeGoal(id);
      } catch (err) {
        console.error("removeGoal failed", err);
        setGoals(snapshot);
      }
    });
  };

  const handleReorder = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const next = [...goals];
    const [moved] = next.splice(fromIdx, 1);
    if (!moved) return;
    next.splice(toIdx, 0, moved);
    setGoals(next);
    const ids = next.map((g) => g.id);
    startTransition(async () => {
      try {
        await reorderGoals(ids);
      } catch (err) {
        console.error("reorderGoals failed", err);
      }
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <BudgetChip summary={summary} />

      <QuickAdd wheelAreas={wheelAreas} onAdd={handleAdd} />

      {goals.length === 0 ? (
        <EmptyState onAdd={handleAdd} />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Goals">
          {goals.map((goal, idx) => (
            <GoalRow
              key={goal.id}
              goal={goal}
              index={idx}
              total={goals.length}
              wheelAreas={wheelAreas}
              wheelLabel={wheelLabel}
              scheduledMinutes={scheduledByGoal[goal.id]}
              effectiveTarget={effectiveTargetByGoal[goal.id]}
              onUpdate={(next) => handleUpdate(goal.id, next)}
              onDelete={() => handleDelete(goal.id)}
              onMoveUp={() => handleReorder(idx, Math.max(0, idx - 1))}
              onMoveDown={() => handleReorder(idx, Math.min(goals.length - 1, idx + 1))}
              onDropAt={(toIdx) => handleReorder(idx, toIdx)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─────────────────────────── Budget chip ─────────────────────────────────── */

function BudgetChip({
  summary
}: {
  summary: ReturnType<typeof summariseAllocation>;
}) {
  if (summary.goalCount === 0) {
    return (
      <div className="card flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-ink-400">Free time this week</div>
          <div className="text-lg font-semibold">{formatMinutes(summary.freeMinutes)}</div>
        </div>
        <div className="text-sm text-ink-400">Add a goal to start filling it.</div>
      </div>
    );
  }

  return (
    <div className="card grid gap-3 sm:grid-cols-3">
      <Stat label="Free time" value={formatMinutes(summary.freeMinutes)} />
      <Stat label="Goals" value={String(summary.goalCount)} />
      <Stat
        label={summary.equalShareGoals > 0 ? "Each unconstrained goal" : "All goals fixed"}
        value={
          summary.equalShareGoals > 0
            ? `~${formatMinutes(summary.perEqualShareMinutes)}/wk`
            : `${formatMinutes(summary.reservedMinutes)} reserved`
        }
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink-400">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

/* ─────────────────────────── Quick add row ───────────────────────────────── */

function QuickAdd({
  wheelAreas,
  onAdd
}: {
  wheelAreas: WheelOption[];
  onAdd: (title: string, draft: GoalDraft) => void;
}) {
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<GoalDraft>(emptyDraft);
  const [open, setOpen] = useState(false);
  const [specialType, setSpecialType] = useState<SpecialGoalType | "">("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onAdd(trimmed, draft);
    setTitle("");
    setDraft(emptyDraft());
    setSpecialType("");
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "/" && !title) {
      event.preventDefault();
      setOpen(true);
    }
  };

  const chips = chipsForGoal({ id: "draft", title: title || "draft", ...draft }, (id) =>
    wheelAreas.find((a) => a.id === id)?.label ?? id
  );

  return (
    <form onSubmit={submit} className="card flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <select
            value={specialType}
            onChange={(e) => {
              const nextType = (e.target.value || "") as SpecialGoalType | "";
              setSpecialType(nextType);
              if (nextType) {
                const preset = SPECIAL_GOAL_PRESETS.find((p) => p.type === nextType);
                if (preset && !title.trim()) setTitle(preset.title);
              }
              setDraft((prev) => applySpecialGoalPreset(prev, nextType || undefined));
            }}
            className="field w-full sm:w-auto"
            aria-label="Special goal type"
          >
            <option value="">Special goal type</option>
            {SPECIAL_GOAL_PRESETS.map((preset) => (
              <option key={preset.type} value={preset.type}>
                {preset.label}
              </option>
            ))}
          </select>
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Add a goal and press Enter"
            className="field flex-1"
            aria-label="Goal title"
          />
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-1 text-xs text-ink-600 dark:bg-ink-900/40 dark:text-ink-200"
            >
              {chip.label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="btn-secondary text-xs"
          >
            {open ? "Hide options" : "+ Options"}
          </button>
          <button type="submit" className="btn-primary text-xs">
            Add
          </button>
        </div>
      </div>
      {open && (
        <OptionsEditor
          draft={draft}
          onChange={setDraft}
          wheelAreas={wheelAreas}
          autoFocus
        />
      )}
    </form>
  );
}

/* ─────────────────────────── Goal row (collapsed + expanded) ─────────────── */

function GoalRow({
  goal,
  index,
  total,
  wheelAreas,
  wheelLabel,
  scheduledMinutes,
  effectiveTarget,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onDropAt
}: {
  goal: WeeklyGoal;
  index: number;
  total: number;
  wheelAreas: WheelOption[];
  wheelLabel: (id: string) => string;
  scheduledMinutes?: number;
  effectiveTarget?: number;
  onUpdate: (next: GoalInput) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDropAt: (toIdx: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editTitle, setEditTitle] = useState(goal.title);
  const [draftDirty, setDraftDirty] = useState<GoalDraft | null>(null);
  const [dragOver, setDragOver] = useState<"top" | "bottom" | null>(null);

  useEffect(() => setEditTitle(goal.title), [goal.title]);

  const chips = chipsForGoal(goal, wheelLabel);

  const draft: GoalDraft = draftDirty ?? extractDraft(goal);

  const commitDraft = (next: GoalDraft) => {
    setDraftDirty(next);
    onUpdate({ title: editTitle.trim() || goal.title, ...next });
  };

  const commitTitle = () => {
    const next = editTitle.trim();
    if (next && next !== goal.title) {
      onUpdate({ title: next, ...(draftDirty ?? extractDraft(goal)) });
    }
  };

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", String(index));
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isTop = e.clientY < rect.top + rect.height / 2;
    setDragOver(isTop ? "top" : "bottom");
  };
  const onDragLeave = () => setDragOver(null);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const fromIdx = Number(e.dataTransfer.getData("text/plain"));
    if (Number.isNaN(fromIdx)) return;
    const toIdx = dragOver === "top" ? index : index + 1;
    setDragOver(null);
    if (fromIdx === index || fromIdx === index + 1) return;
    // Adjust target index when dragging downward over the same item.
    const adjusted = fromIdx < toIdx ? toIdx - 1 : toIdx;
    onDropAt(adjusted);
  };

  return (
    <li
      className={`card relative flex flex-col gap-2 ${
        dragOver === "top" ? "border-t-accent border-t-2" : ""
      } ${dragOver === "bottom" ? "border-b-accent border-b-2" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label="Drag to reorder"
          draggable
          onDragStart={onDragStart}
          className="cursor-grab select-none px-1 text-ink-400 hover:text-ink-900 dark:hover:text-ink-100"
          tabIndex={-1}
        >
          ⋮⋮
        </button>
        <div className="flex flex-1 flex-col">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex flex-1 flex-wrap items-center gap-2 text-left"
            aria-expanded={expanded}
          >
            <span className="text-sm font-medium">{goal.title}</span>
            {chips.length === 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-1 text-xs text-ink-400 dark:bg-ink-900/40">
                Equal share
                {effectiveTarget && effectiveTarget > 0
                  ? ` · ~${formatMinutes(effectiveTarget)}/wk`
                  : ""}
              </span>
            ) : (
              chips.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-1 text-xs text-ink-600 dark:bg-ink-900/40 dark:text-ink-200"
                >
                  {chip.label}
                </span>
              ))
            )}
            {scheduledMinutes !== undefined && effectiveTarget !== undefined && effectiveTarget > 0 && (
              <span className="ml-auto text-xs text-ink-400">
                {formatMinutes(scheduledMinutes)} / {formatMinutes(effectiveTarget)}
              </span>
            )}
          </button>
        </div>
        <div className="flex items-center gap-1">
          <IconButton onClick={onMoveUp} disabled={index === 0} title="Move up">
            ↑
          </IconButton>
          <IconButton
            onClick={onMoveDown}
            disabled={index === total - 1}
            title="Move down"
          >
            ↓
          </IconButton>
          <IconButton onClick={onDelete} title="Remove goal">
            ✕
          </IconButton>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-ink-200 pt-3 dark:border-ink-600">
          <label className="flex flex-col gap-1 text-xs">
            Title
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={commitTitle}
              className="field"
            />
          </label>
          <div className="mt-3">
            <OptionsEditor
              draft={draft}
              onChange={commitDraft}
              wheelAreas={wheelAreas}
              autoFocus={false}
            />
          </div>
        </div>
      )}
    </li>
  );
}

function IconButton({
  children,
  onClick,
  title,
  disabled
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-30 dark:hover:bg-ink-600/40 dark:hover:text-ink-100"
    >
      {children}
    </button>
  );
}

function extractDraft(goal: WeeklyGoal): GoalDraft {
  const draft: GoalDraft = {
    energyMode: goal.energyMode ?? "neutral",
    ppfHorizon: goal.ppfHorizon ?? "unspecified"
  };
  if (goal.minMinutesPerWeek !== undefined) draft.minMinutesPerWeek = goal.minMinutesPerWeek;
  if (goal.maxMinutesPerWeek !== undefined) draft.maxMinutesPerWeek = goal.maxMinutesPerWeek;
  if (goal.minMinutesPerDay !== undefined) draft.minMinutesPerDay = goal.minMinutesPerDay;
  if (goal.maxMinutesPerDay !== undefined) draft.maxMinutesPerDay = goal.maxMinutesPerDay;
  if (goal.frequencyPerWeek !== undefined) draft.frequencyPerWeek = goal.frequencyPerWeek;
  if (goal.dayOfWeek !== undefined) draft.dayOfWeek = goal.dayOfWeek;
  if (goal.wheelAreaId !== undefined) draft.wheelAreaId = goal.wheelAreaId;
  if (goal.ppfPillar !== undefined) draft.ppfPillar = goal.ppfPillar;
  if (goal.earliestHour !== undefined) draft.earliestHour = goal.earliestHour;
  if (goal.latestHour !== undefined) draft.latestHour = goal.latestHour;
  if (goal.anchor !== undefined) draft.anchor = goal.anchor;
  if (goal.specialGoalType !== undefined) draft.specialGoalType = goal.specialGoalType;
  return draft;
}

/* ─────────────────────────── Options editor ──────────────────────────────── */

function OptionsEditor({
  draft,
  onChange,
  wheelAreas,
  autoFocus
}: {
  draft: GoalDraft;
  onChange: (draft: GoalDraft) => void;
  wheelAreas: WheelOption[];
  autoFocus: boolean;
}) {
  const [minUnit, setMinUnit] = useState<"week" | "day">(
    draft.minMinutesPerDay !== undefined ? "day" : "week"
  );
  const [maxUnit, setMaxUnit] = useState<"week" | "day">(
    draft.maxMinutesPerDay !== undefined ? "day" : "week"
  );

  const minValue =
    minUnit === "day" ? draft.minMinutesPerDay : draft.minMinutesPerWeek;
  const maxValue =
    maxUnit === "day" ? draft.maxMinutesPerDay : draft.maxMinutesPerWeek;

  const update = (changes: Partial<GoalDraft>) => onChange({ ...draft, ...changes });

  const setMin = (raw: string) => {
    const n = raw === "" ? undefined : Math.max(0, Math.round(Number(raw)));
    if (minUnit === "day") {
      update({ minMinutesPerDay: n, minMinutesPerWeek: undefined });
    } else {
      update({ minMinutesPerWeek: n, minMinutesPerDay: undefined });
    }
  };
  const setMax = (raw: string) => {
    const n = raw === "" ? undefined : Math.max(1, Math.round(Number(raw)));
    if (maxUnit === "day") {
      update({ maxMinutesPerDay: n, maxMinutesPerWeek: undefined });
    } else {
      update({ maxMinutesPerWeek: n, maxMinutesPerDay: undefined });
    }
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Min time (optional)" hint="Reserved before equal share.">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            step={15}
            value={minValue ?? ""}
            onChange={(e) => setMin(e.target.value)}
            placeholder="0"
            className="field flex-1"
            autoFocus={autoFocus}
          />
          <UnitToggle value={minUnit} onChange={setMinUnit} />
        </div>
      </Field>
      <Field label="Max time (optional)" hint="Cap to keep this goal in check.">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            step={15}
            value={maxValue ?? ""}
            onChange={(e) => setMax(e.target.value)}
            placeholder="∞"
            className="field flex-1"
          />
          <UnitToggle value={maxUnit} onChange={setMaxUnit} />
        </div>
      </Field>
      <Field label="Times per week (optional)" hint="Spread across N days.">
        <input
          type="number"
          min={1}
          max={14}
          value={draft.frequencyPerWeek ?? ""}
          onChange={(e) =>
            update({
              frequencyPerWeek: e.target.value === "" ? undefined : Number(e.target.value)
            })
          }
          placeholder="any"
          className="field"
        />
      </Field>
      <Field label="Pin to day (optional)" hint="Lock the goal to a single day.">
        <select
          value={draft.dayOfWeek ?? ""}
          onChange={(e) =>
            update({ dayOfWeek: (e.target.value || undefined) as DayOfWeek | undefined })
          }
          className="field"
        >
          <option value="">Floating</option>
          {DAY_OPTIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Energy mode" hint="When in the day this lands best.">
        <select
          value={draft.energyMode ?? "neutral"}
          onChange={(e) => update({ energyMode: e.target.value as EnergyMode })}
          className="field"
        >
          <option value="hyperfocus">Deep focus (morning)</option>
          <option value="neutral">Neutral</option>
          <option value="hyperaware">Scanning (afternoon)</option>
        </select>
      </Field>
      <Field label="Special goal type (optional)" hint="Routine/timemap-aware preset.">
        <select
          value={draft.specialGoalType ?? ""}
          onChange={(e) => {
            const nextType = (e.target.value || undefined) as SpecialGoalType | undefined;
            update(applySpecialGoalPreset(draft, nextType));
          }}
          className="field"
        >
          <option value="">None</option>
          {SPECIAL_GOAL_PRESETS.map((preset) => (
            <option key={preset.type} value={preset.type}>
              {preset.label}
            </option>
          ))}
        </select>
      </Field>
      {wheelAreas.length > 0 && (
        <Field label="Wheel area (optional)">
          <select
            value={draft.wheelAreaId ?? ""}
            onChange={(e) => update({ wheelAreaId: e.target.value || undefined })}
            className="field"
          >
            <option value="">—</option>
            {wheelAreas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Pillar (optional)" hint="Personal / Professional / Financial.">
        <select
          value={draft.ppfPillar ?? ""}
          onChange={(e) =>
            update({ ppfPillar: (e.target.value || undefined) as PpfPillarKey | undefined })
          }
          className="field"
        >
          <option value="">—</option>
          <option value="personal">Personal</option>
          <option value="professional">Professional</option>
          <option value="financial">Financial</option>
        </select>
      </Field>
    </div>
  );
}

function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-ink-400">{hint}</span> : null}
    </label>
  );
}

function UnitToggle({
  value,
  onChange
}: {
  value: "week" | "day";
  onChange: (v: "week" | "day") => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Unit"
      className="flex shrink-0 overflow-hidden rounded-md border border-ink-200 text-xs dark:border-ink-600"
    >
      {(["week", "day"] as const).map((unit) => (
        <button
          key={unit}
          type="button"
          role="radio"
          aria-checked={value === unit}
          onClick={() => onChange(unit)}
          className={`px-2 py-1 ${
            value === unit
              ? "bg-accent text-accent-fg"
              : "text-ink-400 hover:text-ink-900 dark:hover:text-ink-100"
          }`}
        >
          /{unit === "week" ? "wk" : "day"}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────── Empty state ─────────────────────────────────── */

function EmptyState({ onAdd }: { onAdd: (title: string, draft: GoalDraft) => void }) {
  return (
    <section className="card flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold">Start with a few ideas</h2>
        <p className="text-xs text-ink-400">
          Tap any to add it; tweak the constraints later by clicking the row.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {STARTER_GOALS.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() =>
              onAdd(s.title, {
                energyMode: s.energy ?? "neutral",
                ppfHorizon: "unspecified"
              })
            }
            className="btn-secondary text-xs"
          >
            + {s.title}
          </button>
        ))}
      </div>
    </section>
  );
}
