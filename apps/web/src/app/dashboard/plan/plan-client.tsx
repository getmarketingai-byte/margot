"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent
} from "react";
import { useRouter } from "next/navigation";
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
  summaryChipsForGoal,
  formatMinutes,
  summariseAllocation
} from "./goal-helpers";
import { goalColorFromKey } from "@/lib/goal-colors";
import { GOAL_FOCUS_EVENT, type GoalFocusDetail } from "@/lib/goal-focus";
import { addGoal, removeGoal, reorderGoals, updateGoal } from "./actions";

type GoalDraft = Omit<WeeklyGoal, "id" | "title">;
type GoalInput = Omit<WeeklyGoal, "id">;

interface WheelOption {
  id: string;
  label: string;
}

type PaceStatus = "ahead" | "on-track" | "behind" | "no-data";

interface GoalPaceInfo {
  status: PaceStatus;
  deltaMinutes: number;
  actualMinutes: number;
  /** Pro-rated weekly target through the current weekday (pace baseline). */
  targetToDateMinutes?: number;
}

interface PlanClientProps {
  initialGoals: WeeklyGoal[];
  /**
   * Full-week free gap total after routines/segments (Pass 1+2 denominator).
   * See `WeekMetrics.utilisation.weekCapacityMinutes`.
   */
  freeMinutesThisWeek: number;
  /** Optional: free capacity from `now` before placement (planning horizon). */
  weekCapacityFromNowMinutes?: number;
  /** Optional: remaining free minutes in full week after placement. */
  remainingWeekMinutes?: number;
  /** Optional: remaining free minutes from now after placement. */
  remainingFromNowMinutes?: number;
  wheelAreas: WheelOption[];
  scheduledByGoal: Record<string, number>;
  effectiveTargetByGoal: Record<string, number>;
  /**
   * Per-goal pace info derived from this week's daily reviews. When omitted
   * (or a goal isn't present), no pace pill is shown next to the goal.
   */
  paceByGoal?: Record<string, GoalPaceInfo>;
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
    energyPolarity: "neutral",
    attentionMode: "unspecified",
    workLayer: "unspecified",
    ppfHorizon: "unspecified",
    commitmentLevel: "committed"
  };
}

function ensureGoalShape(input: GoalInput): GoalInput {
  return {
    ...input,
    energyMode: input.energyMode ?? "neutral",
    energyPolarity: input.energyPolarity ?? "neutral",
    attentionMode: input.attentionMode ?? "unspecified",
    workLayer: input.workLayer ?? "unspecified",
    ppfHorizon: input.ppfHorizon ?? "unspecified",
    commitmentLevel: input.commitmentLevel ?? "committed"
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
  weekCapacityFromNowMinutes,
  remainingWeekMinutes,
  remainingFromNowMinutes,
  wheelAreas,
  scheduledByGoal,
  effectiveTargetByGoal,
  paceByGoal
}: PlanClientProps) {
  const router = useRouter();
  const [goals, setGoals] = useState<WeeklyGoal[]>(initialGoals);
  const [focusRequest, setFocusRequest] = useState<{ goalId: string; nonce: number } | null>(null);
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

  useEffect(() => {
    const onFocusGoal = (event: Event) => {
      const detail = (event as CustomEvent<GoalFocusDetail>).detail;
      if (!detail?.goalId) return;
      setFocusRequest({ goalId: detail.goalId, nonce: Date.now() });
    };
    window.addEventListener(GOAL_FOCUS_EVENT, onFocusGoal);
    return () => window.removeEventListener(GOAL_FOCUS_EVENT, onFocusGoal);
  }, []);

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
      energyPolarity: draft.energyPolarity ?? "neutral",
      attentionMode: draft.attentionMode ?? "unspecified",
      workLayer: draft.workLayer ?? "unspecified",
      ppfHorizon: draft.ppfHorizon ?? "unspecified",
      commitmentLevel: draft.commitmentLevel ?? "committed"
    };
    setGoals((prev) => [...prev, optimistic]);
    const payload = ensureGoalShape({ title, ...draft });
    startTransition(async () => {
      try {
        const { id } = await addGoal(payload);
        setGoals((prev) => prev.map((g) => (g.id === tempId ? { ...g, id } : g)));
        router.refresh();
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
        router.refresh();
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
        router.refresh();
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
        router.refresh();
      } catch (err) {
        console.error("reorderGoals failed", err);
      }
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <BudgetChip
        summary={summary}
        weekCapacityFromNowMinutes={weekCapacityFromNowMinutes}
        remainingWeekMinutes={remainingWeekMinutes}
        remainingFromNowMinutes={remainingFromNowMinutes}
      />

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
              pace={paceByGoal?.[goal.id]}
              onUpdate={(next) => handleUpdate(goal.id, next)}
              onDelete={() => handleDelete(goal.id)}
              onMoveUp={() => handleReorder(idx, Math.max(0, idx - 1))}
              onMoveDown={() => handleReorder(idx, Math.min(goals.length - 1, idx + 1))}
              onDropAt={(fromIdx, toIdx) => handleReorder(fromIdx, toIdx)}
              focusedGoalId={focusRequest?.goalId}
              focusNonce={focusRequest?.nonce}
            />
          ))}
          <li className="list-none">
            <AddGoalTitle onAdd={handleAdd} />
          </li>
        </ul>
      )}
    </div>
  );
}

/* ─────────────────────────── Budget chip ─────────────────────────────────── */

function BudgetChip({
  summary,
  weekCapacityFromNowMinutes,
  remainingWeekMinutes,
  remainingFromNowMinutes
}: {
  summary: ReturnType<typeof summariseAllocation>;
  weekCapacityFromNowMinutes?: number;
  remainingWeekMinutes?: number;
  remainingFromNowMinutes?: number;
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
    <div className="card flex flex-col gap-3">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Total free (week)" value={formatMinutes(summary.freeMinutes)} />
      <Stat
        label={
          remainingFromNowMinutes !== undefined
            ? "Remaining free (from now)"
            : remainingWeekMinutes !== undefined
              ? "Remaining free (week)"
              : "Unallocated remainder"
        }
        value={formatMinutes(
          remainingFromNowMinutes ?? remainingWeekMinutes ?? summary.remainingMinutes
        )}
      />
      <Stat label="Goals" value={String(summary.goalCount)} />
      <Stat
        label={
          summary.hasWeightedShare
            ? "Weekly split"
            : summary.equalShareGoals > 0
              ? "Each unconstrained goal (weekly target)"
              : "All goals fixed"
        }
        value={
          summary.hasWeightedShare
            ? "Weighted (% share)"
            : summary.equalShareGoals > 0
              ? `~${formatMinutes(summary.perEqualShareMinutes)}/wk`
              : `${formatMinutes(summary.reservedMinutes)} reserved`
        }
      />
    </div>
      {weekCapacityFromNowMinutes !== undefined ? (
        <p className="text-xs text-ink-500 dark:text-ink-300">
          Capacity from now (before placement): {formatMinutes(weekCapacityFromNowMinutes)}
          {remainingFromNowMinutes !== undefined
            ? ` · Remaining from now: ${formatMinutes(remainingFromNowMinutes)}`
            : ""}
          {remainingWeekMinutes !== undefined
            ? ` · Remaining in full week (includes past windows): ${formatMinutes(remainingWeekMinutes)}`
            : ""}
        </p>
      ) : null}
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

/** Title-only add row; special types and other constraints live under each goal’s scheduling options. */
function AddGoalTitle({ onAdd }: { onAdd: (title: string, draft: GoalDraft) => void }) {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onAdd(trimmed, emptyDraft());
    setTitle("");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <form
      onSubmit={submit}
      className="card flex flex-col gap-2 border-dashed border-ink-200 sm:flex-row sm:items-center dark:border-ink-600"
    >
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add another goal and press Enter"
        className="field min-w-0 flex-1"
        aria-label="New goal title"
      />
      <button type="submit" className="btn-primary shrink-0 text-xs">
        Add
      </button>
    </form>
  );
}

/* ─────────────────────────── Pace pill ───────────────────────────────────── */

const PACE_BG: Record<PaceStatus, string> = {
  ahead:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  "on-track":
    "bg-ink-100 text-ink-600 dark:bg-ink-900/40 dark:text-ink-200",
  behind:
    "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  "no-data":
    "bg-ink-100 text-ink-400 dark:bg-ink-900/40 dark:text-ink-400"
};

function PacePill({ pace }: { pace: GoalPaceInfo }) {
  let label: string;
  switch (pace.status) {
    case "ahead":
      label = `Ahead ${formatMinutes(pace.deltaMinutes)}`;
      break;
    case "behind":
      label = `Behind ${formatMinutes(-pace.deltaMinutes)}`;
      break;
    case "on-track":
      label = "On track";
      break;
    default:
      label = "No data";
  }
  return (
    <span
      title={
        pace.targetToDateMinutes != null
          ? `${formatMinutes(pace.actualMinutes)} vs ${formatMinutes(pace.targetToDateMinutes)} min (achieved vs pro-rated target to date)`
          : `${formatMinutes(pace.actualMinutes)} min counted for pace`
      }
      className={`rounded-full px-2 py-0.5 text-[11px] ${PACE_BG[pace.status]}`}
    >
      {label}
    </span>
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
  pace,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onDropAt,
  focusedGoalId,
  focusNonce
}: {
  goal: WeeklyGoal;
  index: number;
  total: number;
  wheelAreas: WheelOption[];
  wheelLabel: (id: string) => string;
  scheduledMinutes?: number;
  effectiveTarget?: number;
  pace?: GoalPaceInfo;
  onUpdate: (next: GoalInput) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDropAt: (fromIdx: number, toIdx: number) => void;
  focusedGoalId?: string;
  focusNonce?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editTitle, setEditTitle] = useState(goal.title);
  const [draftDirty, setDraftDirty] = useState<GoalDraft | null>(null);
  const [dragOver, setDragOver] = useState<"top" | "bottom" | null>(null);
  const goalColor = goalColorFromKey(goal.id || goal.title);
  const rowRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => setEditTitle(goal.title), [goal.title]);
  useEffect(() => {
    if (!focusNonce) return;
    if (focusedGoalId !== goal.id) return;
    setExpanded(true);
    rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusNonce, focusedGoalId, goal.id]);

  const allChips = chipsForGoal(goal, wheelLabel);
  const rowChips = summaryChipsForGoal(goal, wheelLabel);
  const rowKeySet = new Set(rowChips.map((c) => c.key));
  const hiddenChips = allChips.filter((c) => !rowKeySet.has(c.key));
  const hiddenChipSummary = hiddenChips.map((c) => c.label).join(" · ");

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
    onDropAt(fromIdx, adjusted);
  };

  return (
    <li
      ref={rowRef}
      className={`card relative flex flex-col gap-2 ${
        dragOver === "top" ? "border-t-accent border-t-2" : ""
      } ${dragOver === "bottom" ? "border-b-accent border-b-2" : ""}`}
      style={{ borderLeftColor: goalColor, borderLeftWidth: 4 }}
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
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: goalColor }}
            />
            <span className="text-sm font-medium" style={{ color: goalColor }}>
              {goal.title}
            </span>
            {pace && pace.status !== "no-data" && (
              <PacePill pace={pace} />
            )}
            {rowChips.length === 0 && hiddenChips.length === 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-1 text-xs text-ink-400 dark:bg-ink-900/40">
                Equal share
                {effectiveTarget && effectiveTarget > 0
                  ? ` · ~${formatMinutes(effectiveTarget)}/wk`
                  : ""}
              </span>
            ) : (
              <>
                {rowChips.map((chip) => (
                  <span
                    key={chip.key}
                    className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-1 text-xs text-ink-600 dark:bg-ink-900/40 dark:text-ink-200"
                  >
                    {chip.label}
                  </span>
                ))}
                {hiddenChips.length > 0 ? (
                  <span
                    title={hiddenChipSummary}
                    className="inline-flex shrink-0 items-center rounded-full border border-dashed border-ink-200 px-1.5 py-0.5 text-[11px] tabular-nums text-ink-500 dark:border-ink-600 dark:text-ink-300"
                  >
                    +{hiddenChips.length}
                  </span>
                ) : null}
              </>
            )}
            {scheduledMinutes !== undefined && effectiveTarget !== undefined && effectiveTarget > 0 && (
              <span
                className="ml-auto text-xs text-ink-400"
                title="Achieved (logs + calendar blocks) / weekly plan target"
              >
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
    energyPolarity: goal.energyPolarity ?? "neutral",
    attentionMode: goal.attentionMode ?? "unspecified",
    workLayer: goal.workLayer ?? "unspecified",
    ppfHorizon: goal.ppfHorizon ?? "unspecified",
    commitmentLevel: goal.commitmentLevel ?? "committed"
  };
  if (goal.minMinutesPerWeek !== undefined) draft.minMinutesPerWeek = goal.minMinutesPerWeek;
  if (goal.maxMinutesPerWeek !== undefined) draft.maxMinutesPerWeek = goal.maxMinutesPerWeek;
  if (goal.minMinutesPerDay !== undefined) draft.minMinutesPerDay = goal.minMinutesPerDay;
  if (goal.maxMinutesPerDay !== undefined) draft.maxMinutesPerDay = goal.maxMinutesPerDay;
  if (goal.frequencyPerWeek !== undefined) draft.frequencyPerWeek = goal.frequencyPerWeek;
  if (goal.daysOfWeek !== undefined) draft.daysOfWeek = goal.daysOfWeek;
  if (goal.dayOfWeek !== undefined) draft.dayOfWeek = goal.dayOfWeek;
  if (goal.wheelAreaId !== undefined) draft.wheelAreaId = goal.wheelAreaId;
  if (goal.ppfPillar !== undefined) draft.ppfPillar = goal.ppfPillar;
  if (goal.earliestHour !== undefined) draft.earliestHour = goal.earliestHour;
  if (goal.latestHour !== undefined) draft.latestHour = goal.latestHour;
  if (goal.anchor !== undefined) draft.anchor = goal.anchor;
  if (goal.specialGoalType !== undefined) draft.specialGoalType = goal.specialGoalType;
  if (goal.allocationSharePercent !== undefined) draft.allocationSharePercent = goal.allocationSharePercent;
  if (goal.scheduleInNiceWeather === true) draft.scheduleInNiceWeather = true;
  if (goal.focusAffinity !== undefined) draft.focusAffinity = goal.focusAffinity;
  if (goal.energyChargeImpact !== undefined) draft.energyChargeImpact = goal.energyChargeImpact;
  if (goal.energyDrainImpact !== undefined) draft.energyDrainImpact = goal.energyDrainImpact;
  return draft;
}

/* ─────────────────────────── Options editor ──────────────────────────────── */

/**
 * Each constraint is opt-in: we render only the ones the user has actually
 * set, with a remove (✕) action. Unset constraints appear as "+ Add X"
 * buttons at the bottom of the editor so the surface stays small until the
 * user explicitly reaches for a constraint. This is the chip-builder pattern
 * applied to the row's editor.
 */
type ConstraintId =
  | "min-week"
  | "min-day"
  | "max-week"
  | "max-day"
  | "share-remainder"
  | "frequency"
  | "days"
  | "nice-weather"
  | "energy"
  | "focus-affinity"
  | "energy-charge"
  | "energy-drain"
  | "special"
  | "wheel"
  | "pillar";

interface ConstraintDef {
  id: ConstraintId;
  label: string;
  isSet: (d: GoalDraft) => boolean;
  initialise: (d: GoalDraft) => Partial<GoalDraft>;
  clear: (d: GoalDraft) => Partial<GoalDraft>;
}

function isDaySet(d: GoalDraft): boolean {
  return Boolean((d.daysOfWeek && d.daysOfWeek.length > 0) || d.dayOfWeek);
}

function OptionsEditor({
  draft,
  onChange,
  wheelAreas
}: {
  draft: GoalDraft;
  onChange: (draft: GoalDraft) => void;
  wheelAreas: WheelOption[];
}) {
  const update = (changes: Partial<GoalDraft>) => onChange({ ...draft, ...changes });

  // Order matters: this is the order rows appear, both as set rows and as
  // "+ Add X" buttons. Keep the high-impact constraints (time, cadence) on
  // top and the categorisation tags (energy, wheel, pillar) at the bottom.
  const constraints: ConstraintDef[] = [
    {
      id: "min-week",
      label: "Min per week",
      isSet: (d) => d.minMinutesPerWeek !== undefined,
      initialise: () => ({ minMinutesPerWeek: 60 }),
      clear: () => ({ minMinutesPerWeek: undefined })
    },
    {
      id: "min-day",
      label: "Min per day",
      isSet: (d) => d.minMinutesPerDay !== undefined,
      initialise: () => ({ minMinutesPerDay: 30 }),
      clear: () => ({ minMinutesPerDay: undefined })
    },
    {
      id: "max-week",
      label: "Max per week",
      isSet: (d) => d.maxMinutesPerWeek !== undefined,
      initialise: () => ({ maxMinutesPerWeek: 300 }),
      clear: () => ({ maxMinutesPerWeek: undefined })
    },
    {
      id: "max-day",
      label: "Max per day",
      isSet: (d) => d.maxMinutesPerDay !== undefined,
      initialise: () => ({ maxMinutesPerDay: 120 }),
      clear: () => ({ maxMinutesPerDay: undefined })
    },
    {
      id: "share-remainder",
      label: "Share of remainder",
      isSet: (d) => d.allocationSharePercent !== undefined,
      initialise: () => ({ allocationSharePercent: 40 }),
      clear: () => ({ allocationSharePercent: undefined })
    },
    {
      id: "frequency",
      label: "Times per week",
      isSet: (d) => d.frequencyPerWeek !== undefined,
      initialise: () => ({ frequencyPerWeek: 3 }),
      clear: () => ({ frequencyPerWeek: undefined })
    },
    {
      id: "days",
      label: "Pin to day(s)",
      isSet: isDaySet,
      initialise: () => ({ daysOfWeek: ["monday"], dayOfWeek: undefined }),
      clear: () => ({ daysOfWeek: undefined, dayOfWeek: undefined })
    },
    {
      id: "nice-weather",
      label: "Nice weather slots",
      isSet: (d) => d.scheduleInNiceWeather === true,
      initialise: () => ({ scheduleInNiceWeather: true }),
      clear: () => ({ scheduleInNiceWeather: undefined })
    },
    {
      id: "energy",
      label: "Energy mode",
      isSet: (d) => d.energyMode !== undefined && d.energyMode !== "neutral",
      initialise: () => ({ energyMode: "hyperfocus" }),
      clear: () => ({ energyMode: "neutral" })
    },
    {
      id: "focus-affinity",
      label: "Focus affinity (battery)",
      isSet: (d) => d.focusAffinity !== undefined,
      initialise: () => ({ focusAffinity: "hyperfocus" }),
      clear: () => ({ focusAffinity: undefined })
    },
    {
      id: "energy-charge",
      label: "Battery charge (0–1)",
      isSet: (d) => d.energyChargeImpact !== undefined,
      initialise: () => ({ energyChargeImpact: 0.7 }),
      clear: () => ({ energyChargeImpact: undefined })
    },
    {
      id: "energy-drain",
      label: "Battery drain (0–1)",
      isSet: (d) => d.energyDrainImpact !== undefined,
      initialise: () => ({ energyDrainImpact: 0.65 }),
      clear: () => ({ energyDrainImpact: undefined })
    },
    {
      id: "special",
      label: "Special goal type",
      isSet: (d) => d.specialGoalType !== undefined,
      initialise: (d) => applySpecialGoalPreset(d, SPECIAL_GOAL_PRESETS[0]?.type),
      clear: (d) => applySpecialGoalPreset(d, undefined)
    },
    {
      id: "wheel",
      label: "Wheel area",
      isSet: (d) => d.wheelAreaId !== undefined,
      initialise: () => ({ wheelAreaId: wheelAreas[0]?.id }),
      clear: () => ({ wheelAreaId: undefined })
    },
    {
      id: "pillar",
      label: "Pillar",
      isSet: (d) => d.ppfPillar !== undefined,
      initialise: () => ({ ppfPillar: "personal" }),
      clear: () => ({ ppfPillar: undefined })
    }
  ];

  // Wheel area only appears when the user has any wheel areas configured.
  const visibleConstraints = constraints.filter(
    (c) => c.id !== "wheel" || wheelAreas.length > 0
  );
  const setConstraints = visibleConstraints.filter((c) => c.isSet(draft));
  const unsetConstraints = visibleConstraints.filter((c) => !c.isSet(draft));
  const clearAllConstraints = () => {
    const cleared = setConstraints.reduce<GoalDraft>(
      (nextDraft, constraint) => ({ ...nextDraft, ...constraint.clear(nextDraft) }),
      draft
    );
    onChange(cleared);
  };

  return (
    <div className="flex flex-col gap-3">
      {setConstraints.length === 0 ? (
        <p className="text-xs text-ink-400">
          No constraints set — this goal gets an equal share of free time. Add a constraint below
          to refine.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={clearAllConstraints}
              className="rounded-full border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:border-accent hover:text-accent dark:border-ink-600 dark:text-ink-200"
            >
              Clear constraints
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {setConstraints.map((c) => (
              <ConstraintRow
                key={c.id}
                label={c.label}
                onRemove={() => update(c.clear(draft))}
              >
                <ConstraintBody
                  id={c.id}
                  draft={draft}
                  update={update}
                  wheelAreas={wheelAreas}
                />
              </ConstraintRow>
            ))}
          </div>
        </div>
      )}

      {unsetConstraints.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-ink-200 pt-3 dark:border-ink-600">
          <span className="text-[11px] uppercase tracking-wide text-ink-400">Add constraint</span>
          <div className="flex flex-wrap gap-2">
            {unsetConstraints.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => update(c.initialise(draft))}
                className="rounded-full border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:border-accent hover:text-accent dark:border-ink-600 dark:text-ink-200"
              >
                + {c.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConstraintRow({
  label,
  children,
  onRemove
}: {
  label: string;
  children: React.ReactNode;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-ink-200 bg-ink-50/50 p-2 dark:border-ink-600 dark:bg-ink-900/40">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{label}</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          title={`Remove ${label}`}
          className="rounded p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-900 dark:hover:bg-ink-600/40 dark:hover:text-ink-100"
        >
          ✕
        </button>
      </div>
      {children}
    </div>
  );
}

function ConstraintBody({
  id,
  draft,
  update,
  wheelAreas
}: {
  id: ConstraintId;
  draft: GoalDraft;
  update: (changes: Partial<GoalDraft>) => void;
  wheelAreas: WheelOption[];
}) {
  switch (id) {
    case "min-week":
      return <DurationField value={draft.minMinutesPerWeek} onChange={(v) => update({ minMinutesPerWeek: v })} hint="Reserved before equal share." />;
    case "min-day":
      return <DurationField value={draft.minMinutesPerDay} onChange={(v) => update({ minMinutesPerDay: v })} hint="Daily floor on scheduled days." />;
    case "max-week":
      return <DurationField value={draft.maxMinutesPerWeek} onChange={(v) => update({ maxMinutesPerWeek: v === undefined ? undefined : Math.max(1, v) })} hint="Weekly ceiling." />;
    case "max-day":
      return <DurationField value={draft.maxMinutesPerDay} onChange={(v) => update({ maxMinutesPerDay: v === undefined ? undefined : Math.max(1, v) })} hint="Daily cap so this doesn't dominate a day." />;
    case "share-remainder":
      return (
        <label className="flex flex-col gap-1 text-xs">
          <span>Percent (1–100)</span>
          <input
            type="number"
            min={1}
            max={100}
            value={draft.allocationSharePercent ?? ""}
            onChange={(e) => {
              if (e.target.value === "") {
                update({ allocationSharePercent: undefined });
                return;
              }
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              update({ allocationSharePercent: Math.min(100, Math.max(1, Math.round(n))) });
            }}
            placeholder="40"
            className="field"
          />
          <span className="text-ink-400">
            Share of time left after weekly mins are reserved (weights the post-floor split between
            goals).
          </span>
        </label>
      );
    case "frequency":
      return (
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
          placeholder="3"
          className="field"
        />
      );
    case "nice-weather":
      return (
        <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-300">
          Only schedule during timemap &quot;outside&quot; windows from your weather settings (same
          layer as the green preview on the calendar). If weather is disabled or no forecast
          overlaps your free time, this is ignored so the goal can still land.
        </p>
      );
    case "days": {
      const pinnedDays = draft.daysOfWeek?.length
        ? draft.daysOfWeek
        : draft.dayOfWeek
          ? [draft.dayOfWeek]
          : [];
      return (
        <div className="grid grid-cols-7 gap-1">
          {DAY_OPTIONS.map((d) => {
            const checked = pinnedDays.includes(d.value);
            return (
              <label
                key={d.value}
                className={`flex cursor-pointer items-center justify-center rounded border px-1 py-1 text-[11px] ${
                  checked
                    ? "border-accent bg-accent text-accent-fg"
                    : "border-ink-200 hover:border-accent/40 dark:border-ink-600"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...pinnedDays, d.value]
                      : pinnedDays.filter((day) => day !== d.value);
                    update({
                      daysOfWeek: next.length > 0 ? next : undefined,
                      dayOfWeek: undefined
                    });
                  }}
                />
                {d.label}
              </label>
            );
          })}
        </div>
      );
    }
    case "energy":
      return (
        <select
          value={draft.energyMode ?? "neutral"}
          onChange={(e) => update({ energyMode: e.target.value as EnergyMode })}
          className="field"
        >
          <option value="hyperfocus">Deep focus (morning)</option>
          <option value="neutral">Neutral</option>
          <option value="hyperaware">Scanning (afternoon)</option>
        </select>
      );
    case "focus-affinity":
      return (
        <select
          value={draft.focusAffinity ?? ""}
          onChange={(e) =>
            update({
              focusAffinity:
                e.target.value === ""
                  ? undefined
                  : (e.target.value as "hyperfocus" | "hyperaware" | "mixed")
            })
          }
          className="field"
        >
          <option value="">—</option>
          <option value="hyperfocus">Hyper focus (charges)</option>
          <option value="hyperaware">Hyper aware (drains)</option>
          <option value="mixed">Mixed</option>
        </select>
      );
    case "energy-charge":
      return (
        <label className="flex flex-col gap-1 text-xs">
          <span>0 = low, 1 = strong recharge for scheduling</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={draft.energyChargeImpact ?? ""}
            onChange={(e) => {
              if (e.target.value === "") {
                update({ energyChargeImpact: undefined });
                return;
              }
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              update({ energyChargeImpact: Math.min(1, Math.max(0, n)) });
            }}
            className="field"
          />
        </label>
      );
    case "energy-drain":
      return (
        <label className="flex flex-col gap-1 text-xs">
          <span>0 = low, 1 = heavy awareness / social drain</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={draft.energyDrainImpact ?? ""}
            onChange={(e) => {
              if (e.target.value === "") {
                update({ energyDrainImpact: undefined });
                return;
              }
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              update({ energyDrainImpact: Math.min(1, Math.max(0, n)) });
            }}
            className="field"
          />
        </label>
      );
    case "special":
      return (
        <select
          value={draft.specialGoalType ?? ""}
          onChange={(e) => {
            const nextType = (e.target.value || undefined) as SpecialGoalType | undefined;
            update(applySpecialGoalPreset(draft, nextType));
          }}
          className="field"
        >
          <option value="">— Pick a preset —</option>
          {SPECIAL_GOAL_PRESETS.map((preset) => (
            <option key={preset.type} value={preset.type}>
              {preset.label}
            </option>
          ))}
        </select>
      );
    case "wheel":
      return (
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
      );
    case "pillar":
      return (
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
      );
  }
}

/**
 * Combined number + h/m unit toggle for any "minutes" field. Stores minutes
 * internally and lets the user input either decimal hours (1.5) or whole
 * minutes (90). Defaults to hours since most goals are expressed that way.
 */
function DurationField({
  value,
  onChange,
  hint
}: {
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  hint?: string;
}) {
  const [unit, setUnit] = useState<"hours" | "minutes">("hours");

  const display = value === undefined ? "" : unit === "hours" ? String(value / 60) : String(value);

  const onInput = (raw: string) => {
    if (raw === "") return onChange(undefined);
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onChange(Math.max(0, Math.round(unit === "hours" ? n * 60 : n)));
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          step={unit === "hours" ? 0.25 : 15}
          value={display}
          onChange={(e) => onInput(e.target.value)}
          className="field flex-1"
        />
        <UnitToggle
          value={unit}
          onChange={setUnit}
          ariaLabel="Unit"
          options={[
            { value: "hours", label: "h" },
            { value: "minutes", label: "m" }
          ]}
        />
      </div>
      {hint ? <span className="text-[11px] text-ink-400">{hint}</span> : null}
    </div>
  );
}

function UnitToggle({
  value,
  onChange,
  ariaLabel,
  options
}: {
  value: "hours" | "minutes";
  onChange: (v: "hours" | "minutes") => void;
  ariaLabel?: string;
  options?: ReadonlyArray<{ value: "hours" | "minutes"; label: string }>;
}) {
  const toggleOptions = options ?? [
    { value: "hours", label: "h" },
    { value: "minutes", label: "m" }
  ];
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel ?? "Unit"}
      className="flex shrink-0 overflow-hidden rounded-md border border-ink-200 text-xs dark:border-ink-600"
    >
      {toggleOptions.map((unit) => (
        <button
          key={unit.value}
          type="button"
          role="radio"
          aria-checked={value === unit.value}
          onClick={() => onChange(unit.value)}
          className={`px-2 py-1 ${
            value === unit.value
              ? "bg-accent text-accent-fg"
              : "text-ink-400 hover:text-ink-900 dark:hover:text-ink-100"
          }`}
        >
          {unit.label}
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
                energyPolarity: "neutral",
                attentionMode: "unspecified",
                workLayer: "unspecified",
                ppfHorizon: "unspecified",
                commitmentLevel: "committed"
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
