"use client";

import {
  Fragment,
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
} from "@margot/schema";
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
  /**
   * Epoch ms for the user's local midnight on `date`. Used to map
   * planned-block timestamps to minute-of-day rows in the timeline.
   */
  dayStartMs: number;
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
  interruption: "Interruption",
  other: "Other"
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
  return b.dragKey ?? `${b.goalId}:${b.startMs}`;
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

/** Stable key for "same activity" when suggesting bridge fills between slots. */
function activityKeyForBridge(slot: LogSlot): string | null {
  if (slot.category === "goal") {
    const id = slot.goalId?.trim();
    if (!id) return null;
    return `goal:${id}`;
  }
  return `cat:${slot.category}`;
}

interface BridgeGapSuggestion {
  fillMinutes: number[];
  endpoint: LogSlot;
}

/**
 * Empty 15-min rows strictly between two logged rows with the same activity
 * (same goal, or same non-goal category).
 */
function computeBridgeGapSuggestions(
  slotIndex: Map<number, LogSlot>,
  slotMinutes: number[]
): BridgeGapSuggestion[] {
  const filled = slotMinutes.filter((m) => slotIndex.has(m));
  const out: BridgeGapSuggestion[] = [];
  for (let i = 0; i < filled.length; i++) {
    const m1 = filled[i]!;
    const s1 = slotIndex.get(m1);
    if (!s1) continue;
    const k1 = activityKeyForBridge(s1);
    if (!k1) continue;
    for (let j = i + 1; j < filled.length; j++) {
      const m2 = filled[j]!;
      const s2 = slotIndex.get(m2);
      if (!s2) continue;
      if (activityKeyForBridge(s2) !== k1) continue;
      const gap = slotMinutes.filter((m) => m1 < m && m < m2);
      if (gap.length === 0) continue;
      if (gap.some((m) => slotIndex.has(m))) continue;
      out.push({ fillMinutes: gap, endpoint: s1 });
    }
  }
  return out;
}

export function DailyReviewClient({
  date,
  initialReview,
  goals,
  dayLabel,
  dayStartMs,
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

  /**
   * Fill the empty 15-min rows that fall inside `block` with the block's goal.
   * Existing entries are left untouched so the user's reality always wins.
   */
  const applyBlockToLog = (block: AllocatedBlockSnapshot) => {
    const blockStart = Math.round((block.startMs - dayStartMs) / 60_000);
    const blockEnd = Math.round((block.endMs - dayStartMs) / 60_000);
    const from = Math.max(blockStart, logStartMinute);
    const to = Math.min(blockEnd, logEndMinute);
    if (from >= to) return;
    const existingByMinute = new Map(
      review.slots.map((s) => [s.startMinute, s] as const)
    );
    const additions: LogSlot[] = [];
    for (let m = from; m < to; m += SLOT_LENGTH_MIN) {
      if (existingByMinute.has(m)) continue;
      additions.push({
        startMinute: m,
        endMinute: m + SLOT_LENGTH_MIN,
        category: "goal",
        goalId: block.goalId,
        energy: "neutral"
      });
    }
    if (additions.length === 0) return;
    flushSlots(
      [...review.slots, ...additions].sort(
        (a, b) => a.startMinute - b.startMinute
      )
    );
  };

  /**
   * Remove rows tagged to the block's goal that fall inside `block`. Rows
   * tagged to a different goal/category are kept (the user logged something
   * else there on purpose).
   */
  const clearBlockFromLog = (block: AllocatedBlockSnapshot) => {
    const blockStart = Math.round((block.startMs - dayStartMs) / 60_000);
    const blockEnd = Math.round((block.endMs - dayStartMs) / 60_000);
    const remaining = review.slots.filter((s) => {
      const inRange = s.startMinute >= blockStart && s.startMinute < blockEnd;
      if (!inRange) return true;
      return !(s.category === "goal" && s.goalId === block.goalId);
    });
    if (remaining.length === review.slots.length) return;
    flushSlots(remaining);
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

      <TimelineCard
        slotMinutes={slotMinutes}
        slotIndex={slotIndex}
        blocks={review.plannedBlocksSnapshot}
        blockMarks={review.blockMarks}
        goals={goals}
        goalById={goalById}
        dayStartMs={dayStartMs}
        logStartMinute={logStartMinute}
        logEndMinute={logEndMinute}
        onUpdateSlot={updateSlot}
        onClearSlot={clearSlot}
        onSetBlockMark={updateBlockMark}
        onApplyBlock={applyBlockToLog}
        onClearBlock={clearBlockFromLog}
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

/**
 * Combined 15-minute log + planned-block timeline. Planned blocks render as
 * inline section headers above the slot rows they cover, with a colored rail
 * tying the header to those rows. The block header carries the status mark
 * (done/partial/skipped) plus shortcut actions to bulk-fill or clear the
 * underlying log rows from the plan.
 */
function TimelineCard({
  slotMinutes,
  slotIndex,
  blocks,
  blockMarks,
  goals,
  goalById,
  dayStartMs,
  logStartMinute,
  logEndMinute,
  onUpdateSlot,
  onClearSlot,
  onSetBlockMark,
  onApplyBlock,
  onClearBlock
}: {
  slotMinutes: number[];
  slotIndex: Map<number, LogSlot>;
  blocks: AllocatedBlockSnapshot[];
  blockMarks: BlockMark[];
  goals: WeeklyGoal[];
  goalById: Map<string, WeeklyGoal>;
  dayStartMs: number;
  logStartMinute: number;
  logEndMinute: number;
  onUpdateSlot: (startMinute: number, patch: Partial<LogSlot>) => void;
  onClearSlot: (startMinute: number) => void;
  onSetBlockMark: (blockKey: string, status: BlockMark["status"] | null) => void;
  onApplyBlock: (block: AllocatedBlockSnapshot) => void;
  onClearBlock: (block: AllocatedBlockSnapshot) => void;
}) {
  // Map each visible slot start-minute to the block (if any) that covers it.
  // Object identity is preserved so we can detect block boundaries with
  // strict-equality compares against the previous slot's block.
  const blockBySlot = useMemo(() => {
    const out = new Map<number, AllocatedBlockSnapshot>();
    for (const b of blocks) {
      const blockStart = Math.round((b.startMs - dayStartMs) / 60_000);
      const blockEnd = Math.round((b.endMs - dayStartMs) / 60_000);
      const from = Math.max(blockStart, logStartMinute);
      const to = Math.min(blockEnd, logEndMinute);
      const aligned = from - (from % SLOT_LENGTH_MIN);
      for (let m = aligned; m < to; m += SLOT_LENGTH_MIN) {
        if (m < logStartMinute) continue;
        out.set(m, b);
      }
    }
    return out;
  }, [blocks, dayStartMs, logStartMinute, logEndMinute]);

  const markByKey = useMemo(
    () => new Map(blockMarks.map((m) => [m.blockKey, m] as const)),
    [blockMarks]
  );

  // Per-block capture stats for the header chip.
  const blockStats = useMemo(() => {
    const out = new Map<
      string,
      { totalRows: number; filledRows: number; matchedRows: number }
    >();
    for (const b of blocks) {
      const blockStart = Math.round((b.startMs - dayStartMs) / 60_000);
      const blockEnd = Math.round((b.endMs - dayStartMs) / 60_000);
      const from = Math.max(blockStart, logStartMinute);
      const to = Math.min(blockEnd, logEndMinute);
      let totalRows = 0;
      let filledRows = 0;
      let matchedRows = 0;
      const aligned = from - (from % SLOT_LENGTH_MIN);
      for (let m = aligned; m < to; m += SLOT_LENGTH_MIN) {
        if (m < logStartMinute) continue;
        totalRows++;
        const slot = slotIndex.get(m);
        if (slot) {
          filledRows++;
          if (slot.goalId === b.goalId) {
            matchedRows++;
          }
        }
      }
      out.set(blockKeyFor(b), { totalRows, filledRows, matchedRows });
    }
    return out;
  }, [blocks, dayStartMs, logStartMinute, logEndMinute, slotIndex]);

  const bridgeHintByMinute = useMemo(() => {
    const map = new Map<number, { endpoint: LogSlot; activityTitle: string }>();
    for (const s of computeBridgeGapSuggestions(slotIndex, slotMinutes)) {
      const ep = s.endpoint;
      const activityTitle =
        ep.category === "goal" && ep.goalId
          ? goalById.get(ep.goalId)?.title ?? "Goal"
          : CATEGORY_LABEL[ep.category];
      for (const m of s.fillMinutes) {
        map.set(m, { endpoint: ep, activityTitle });
      }
    }
    return map;
  }, [slotIndex, slotMinutes, goalById]);

  const totalRows = slotMinutes.length;
  const filledRows = slotMinutes.filter((m) => slotIndex.has(m)).length;

  return (
    <section className="card">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Time-of-day log</h2>
          <p className="text-xs text-ink-400">
            What did you actually do? Planned blocks are highlighted in-line —
            confirm them in one click or override row-by-row.
          </p>
        </div>
        <div className="text-xs text-ink-400">
          Captured {formatMinutes(filledRows * SLOT_LENGTH_MIN)} of{" "}
          {formatMinutes(totalRows * SLOT_LENGTH_MIN)} window
        </div>
      </header>
      {blocks.length === 0 ? (
        <p className="mb-3 rounded-md border border-dashed border-ink-200 bg-ink-50/60 p-2 text-xs text-ink-400 dark:border-ink-600 dark:bg-ink-900/40">
          No planned blocks were captured for this day yet — open this page
          during the planning week to seed a snapshot from the allocator.
        </p>
      ) : null}
      <ul className="flex flex-col">
        {slotMinutes.map((startMinute) => {
          const block = blockBySlot.get(startMinute);
          const prevBlock = blockBySlot.get(startMinute - SLOT_LENGTH_MIN);
          const isFirstOfBlock = !!block && block !== prevBlock;
          const isLastOfBlock =
            !!block && block !== blockBySlot.get(startMinute + SLOT_LENGTH_MIN);
          return (
            <Fragment key={startMinute}>
              {isFirstOfBlock && block ? (
                <li className="pt-2">
                  <PlannedBlockHeader
                    block={block}
                    goalTitle={goalById.get(block.goalId)?.title ?? block.title}
                    mark={markByKey.get(blockKeyFor(block))}
                    stats={blockStats.get(blockKeyFor(block))}
                    onSetMark={(status) =>
                      onSetBlockMark(blockKeyFor(block), status)
                    }
                    onApply={() => onApplyBlock(block)}
                    onClear={() => onClearBlock(block)}
                  />
                </li>
              ) : null}
              <SlotRow
                startMinute={startMinute}
                slot={slotIndex.get(startMinute)}
                block={block}
                bridgeHint={bridgeHintByMinute.get(startMinute)}
                isFirstOfBlock={isFirstOfBlock}
                isLastOfBlock={isLastOfBlock}
                goals={goals}
                onUpdate={onUpdateSlot}
                onClear={onClearSlot}
              />
            </Fragment>
          );
        })}
      </ul>
    </section>
  );
}

function PlannedBlockHeader({
  block,
  goalTitle,
  mark,
  stats,
  onSetMark,
  onApply,
  onClear
}: {
  block: AllocatedBlockSnapshot;
  goalTitle: string;
  mark: BlockMark | undefined;
  stats: { totalRows: number; filledRows: number; matchedRows: number } | undefined;
  onSetMark: (status: BlockMark["status"] | null) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const color = goalColorFromKey(block.goalId);
  const start = new Date(block.startMs);
  const end = new Date(block.endMs);
  const startLabel = start.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
  const endLabel = end.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
  const matched = stats?.matchedRows ?? 0;
  const total = stats?.totalRows ?? 0;
  const hasMatched = matched > 0;
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink-200 bg-ink-50/60 px-3 py-2 dark:border-ink-600 dark:bg-ink-900/50"
      style={{ borderLeftColor: color, borderLeftWidth: 4 }}
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2 text-sm font-medium" style={{ color }}>
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
          {goalTitle}
        </div>
        <div className="text-xs text-ink-400">
          Planned {startLabel} – {endLabel}
          {total > 0 ? (
            <>
              {" · "}
              <span className={hasMatched ? "text-ink-600 dark:text-ink-200" : undefined}>
                {matched}/{total} on-plan
              </span>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          ariaLabel={`Status for ${goalTitle}`}
          options={STATUS_OPTIONS}
          value={mark?.status ?? null}
          onChange={(next) => onSetMark(next === mark?.status ? null : next)}
          allowClear
        />
        <button
          type="button"
          className="rounded-full border border-ink-200 px-2 py-1 text-xs text-ink-600 hover:border-accent/40 hover:text-ink-900 sm:py-0.5 sm:text-[11px] dark:border-ink-600 dark:text-ink-200 dark:hover:text-ink-100"
          onClick={onApply}
          title="Tag every empty 15-min row in this block to this goal"
        >
          Apply to log
        </button>
        {hasMatched ? (
          <button
            type="button"
            className="rounded-full border border-transparent px-2 py-1 text-xs text-ink-400 hover:text-ink-900 sm:py-0.5 sm:text-[11px] dark:hover:text-ink-100"
            onClick={onClear}
            title="Remove rows tagged to this goal from this block's range"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

const SLOT_ACTION_PILL_CLASS =
  "rounded-full border border-ink-200 px-2 py-1 text-xs text-ink-500 hover:border-accent/40 hover:text-ink-900 sm:py-0.5 sm:text-[11px] dark:border-ink-600 dark:text-ink-300 dark:hover:text-ink-100";

function SlotRow({
  startMinute,
  slot,
  block,
  bridgeHint,
  isFirstOfBlock,
  isLastOfBlock,
  goals,
  onUpdate,
  onClear
}: {
  startMinute: number;
  slot: LogSlot | undefined;
  block: AllocatedBlockSnapshot | undefined;
  bridgeHint?: { endpoint: LogSlot; activityTitle: string };
  isFirstOfBlock: boolean;
  isLastOfBlock: boolean;
  goals: WeeklyGoal[];
  onUpdate: (startMinute: number, patch: Partial<LogSlot>) => void;
  onClear: (startMinute: number) => void;
}) {
  const slotColor = slot?.goalId ? goalColorFromKey(slot.goalId) : undefined;
  const blockColor = block ? goalColorFromKey(block.goalId) : undefined;
  // Prefer the slot color (what actually happened) for the rail; fall back to
  // the block color so empty rows still show planned-context.
  const railColor = slotColor ?? blockColor;
  const inBlockClass = block
    ? "bg-ink-50/40 dark:bg-ink-900/30"
    : "";
  // Round corners on first/last row of a block so the rail looks contiguous.
  const blockRadius = block
    ? `${isFirstOfBlock ? "rounded-tl-md " : ""}${isLastOfBlock ? "rounded-bl-md" : ""}`
    : "";
  const bridgeMatchesPlannedGoal =
    !!block &&
    !!bridgeHint &&
    bridgeHint.endpoint.category === "goal" &&
    bridgeHint.endpoint.goalId === block.goalId;
  const showBridgePill = !!bridgeHint && !slot && !bridgeMatchesPlannedGoal;

  return (
    <li
      className={`grid grid-cols-[56px_minmax(0,1fr)] grid-rows-[auto_auto] items-start gap-x-2 gap-y-1 border-b border-ink-200 py-1.5 last:border-b-0 dark:border-ink-600 sm:grid-cols-[64px_minmax(0,1fr)_auto] sm:grid-rows-none sm:gap-y-0 ${inBlockClass} ${blockRadius}`}
      style={
        railColor
          ? { borderLeftWidth: 3, borderLeftColor: railColor, paddingLeft: 8 }
          : undefined
      }
    >
      <div className="col-start-1 row-start-1 pt-1 font-mono text-xs text-ink-400">
        {fmtTime(startMinute)}
      </div>
      <div className="col-start-2 row-start-1 flex min-w-0 flex-col gap-1 sm:col-start-2">
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
          {/* Empty placeholder shows the planned goal's title when present so
              the user knows what they're "accepting" before clicking. */}
          <option value="">
            {block ? `— planned: ${block.title} —` : "—"}
          </option>
          <optgroup label="Goals">
            {goals.map((g) => (
              <option key={g.id} value={`goal:${g.id}`}>
                {g.title}
              </option>
            ))}
          </optgroup>
          <optgroup label="Not on a goal">
            <option value="cat:system">{CATEGORY_LABEL.system}</option>
            <option value="cat:unplanned">{CATEGORY_LABEL.unplanned}</option>
            <option value="cat:interruption">{CATEGORY_LABEL.interruption}</option>
            <option value="cat:other">{CATEGORY_LABEL.other}</option>
          </optgroup>
        </select>
        {(block && !slot) || showBridgePill ? (
          <div className="flex flex-wrap items-center gap-2">
            {block && !slot ? (
              <button
                type="button"
                className={SLOT_ACTION_PILL_CLASS}
                onClick={() =>
                  onUpdate(startMinute, {
                    category: "goal",
                    goalId: block.goalId
                  })
                }
                title={`Accept the planned ${block.title} for this 15 min`}
              >
                Accept plan
              </button>
            ) : null}
            {showBridgePill ? (
              <button
                type="button"
                className={SLOT_ACTION_PILL_CLASS}
                onClick={() => {
                  const ep = bridgeHint.endpoint;
                  onUpdate(startMinute, {
                    category: ep.category,
                    ...(ep.category === "goal" && ep.goalId
                      ? { goalId: ep.goalId }
                      : { goalId: undefined })
                  });
                }}
                title={`Log this 15 min as ${bridgeHint.activityTitle} — same activity as the rows before and after this gap`}
              >
                Continue {bridgeHint.activityTitle}
              </button>
            ) : null}
          </div>
        ) : null}
        <input
          type="text"
          className="field text-xs"
          placeholder={
            slot?.category === "other"
              ? "What were you doing?"
              : "Note (optional)"
          }
          value={slot?.note ?? ""}
          disabled={!slot}
          onChange={(e) =>
            onUpdate(startMinute, { note: e.target.value || undefined })
          }
        />
      </div>
      <div className="col-start-2 row-start-2 flex flex-wrap items-center justify-between gap-2 sm:col-start-3 sm:row-start-1 sm:justify-end sm:gap-2 sm:pt-1">
        <SegmentedControl
          ariaLabel={`Energy state at ${fmtTime(startMinute)}`}
          options={ENERGY_OPTIONS}
          value={slot?.energy ?? "neutral"}
          onChange={(next) => onUpdate(startMinute, { energy: next })}
          disabled={!slot}
        />
        <button
          type="button"
          className="min-h-[44px] min-w-[44px] text-xs text-ink-400 hover:text-ink-900 sm:min-h-0 sm:min-w-0 dark:hover:text-ink-100"
          onClick={() => onClear(startMinute)}
          aria-label={`Clear log at ${fmtTime(startMinute)}`}
          disabled={!slot}
        >
          ×
        </button>
      </div>
    </li>
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
            className={`rounded-full border px-2.5 py-1 text-xs transition sm:px-2 sm:py-0.5 sm:text-[11px] ${
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
          className="rounded-full border border-transparent px-2.5 py-1 text-xs text-ink-400 hover:text-ink-900 sm:px-2 sm:py-0.5 sm:text-[11px] dark:hover:text-ink-100"
          onClick={() => onChange(value)}
          aria-label="Clear status"
        >
          clear
        </button>
      )}
    </div>
  );
}
