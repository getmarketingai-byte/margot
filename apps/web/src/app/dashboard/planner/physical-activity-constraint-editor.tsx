"use client";

import { useMemo } from "react";
import type { DayOfWeek, GymSettings } from "@calendar-automations/schema";
import { normalisePlacementIdealClockBoundary } from "@calendar-automations/schema";
import {
  ConstraintCard,
  DurationField,
  IdealClockTimesField,
  IdealPlacementClockAfterField,
  IdealPlacementClockBeforeField,
  normaliseIdealClockTimes,
  SessionsPerWeekField,
  WeekdayToggleGrid,
  type IdealClockTime
} from "@/components/scheduling-constraints";

export type PhysicalRoutineDraft = {
  sessionsPerWeekMin: number;
  sessionsPerWeekMax: number;
  sessionMinutesMin: number;
  sessionMinutesMax: number;
  minMinutesPerBlock?: number;
  maxAutoBlocksPerDay?: number;
  plannerDaysOfWeek?: DayOfWeek[];
  idealBlockTimes: IdealClockTime[];
  earliestStart: { hour: number; minute: number };
  latestEnd: { hour: number; minute: number };
};

export type GymConstraintId =
  | "sessions-range"
  | "session-length"
  | "min-block"
  | "max-blocks-day"
  | "days"
  | "ideal-start-times"
  | "ideal-after-local"
  | "ideal-before-local";

function idealAfterIsSet(d: PhysicalRoutineDraft): boolean {
  return !(d.earliestStart.hour === 0 && d.earliestStart.minute === 0);
}

function idealBeforeIsSet(d: PhysicalRoutineDraft): boolean {
  return !(d.latestEnd.hour === 23 && d.latestEnd.minute === 59);
}

function isDaySet(d: PhysicalRoutineDraft): boolean {
  return Boolean(d.plannerDaysOfWeek && d.plannerDaysOfWeek.length > 0);
}

interface GymConstraintDef {
  id: GymConstraintId;
  label: string;
  removable: boolean;
  isSet: (d: PhysicalRoutineDraft) => boolean;
  initialise: (d: PhysicalRoutineDraft) => Partial<PhysicalRoutineDraft>;
  clear: (d: PhysicalRoutineDraft) => Partial<PhysicalRoutineDraft>;
}

const gymConstraintDefs: GymConstraintDef[] = [
  {
    id: "sessions-range",
    label: "Times per week",
    removable: false,
    isSet: () => true,
    initialise: () => ({}),
    clear: () => ({})
  },
  {
    id: "session-length",
    label: "Session length",
    removable: false,
    isSet: () => true,
    initialise: () => ({}),
    clear: () => ({})
  },
  {
    id: "min-block",
    label: "Min block size",
    removable: true,
    isSet: (d) => d.minMinutesPerBlock !== undefined,
    initialise: () => ({ minMinutesPerBlock: 4 * 60 }),
    clear: () => ({ minMinutesPerBlock: undefined })
  },
  {
    id: "max-blocks-day",
    label: "Max blocks / day",
    removable: true,
    isSet: (d) => d.maxAutoBlocksPerDay !== undefined,
    initialise: () => ({ maxAutoBlocksPerDay: 2 }),
    clear: () => ({ maxAutoBlocksPerDay: undefined })
  },
  {
    id: "days",
    label: "Pin to day(s)",
    removable: true,
    isSet: isDaySet,
    initialise: () => ({ plannerDaysOfWeek: ["monday"] }),
    clear: () => ({ plannerDaysOfWeek: undefined })
  },
  {
    id: "ideal-start-times",
    label: "Ideal start times",
    removable: false,
    isSet: () => true,
    initialise: () => ({}),
    clear: () => ({})
  },
  {
    id: "ideal-after-local",
    label: "Ideal times — after",
    removable: true,
    isSet: idealAfterIsSet,
    initialise: () => ({ earliestStart: { hour: 6, minute: 0 } }),
    clear: () => ({ earliestStart: { hour: 0, minute: 0 } })
  },
  {
    id: "ideal-before-local",
    label: "Ideal times — before",
    removable: true,
    isSet: idealBeforeIsSet,
    initialise: () => ({ latestEnd: { hour: 22, minute: 0 } }),
    clear: () => ({ latestEnd: { hour: 23, minute: 59 } })
  }
];

export function physicalDraftFromGym(g: GymSettings): PhysicalRoutineDraft {
  const cadenceFb = g.sessionsPerWeek;
  return {
    sessionsPerWeekMin: g.sessionsPerWeekMin ?? cadenceFb,
    sessionsPerWeekMax: g.sessionsPerWeekMax ?? cadenceFb,
    sessionMinutesMin: g.sessionMinutesMin ?? g.runMinutes,
    sessionMinutesMax: g.sessionMinutesMax ?? g.runMinutes,
    minMinutesPerBlock: g.minMinutesPerBlock,
    maxAutoBlocksPerDay: g.maxAutoBlocksPerDay,
    plannerDaysOfWeek: g.plannerDaysOfWeek,
    idealBlockTimes: normaliseIdealClockTimes(g.idealBlockTimes, { hour: 11, minute: 30 }),
    earliestStart: { ...g.earliestStart },
    latestEnd: { ...g.latestEnd }
  };
}

export function buildPhysicalRoutinePayload(
  plannerBlockEnabled: boolean,
  blockLabel: string,
  draft: PhysicalRoutineDraft
) {
  return {
    plannerBlockEnabled,
    blockLabel: blockLabel.trim() || "Physical activity",
    ...draft
  };
}

function GymConstraintBody({
  id,
  draft,
  update
}: {
  id: GymConstraintId;
  draft: PhysicalRoutineDraft;
  update: (changes: Partial<PhysicalRoutineDraft>) => void;
}) {
  switch (id) {
    case "sessions-range":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <SessionsPerWeekField
            label="Min times per week (1–14)"
            value={draft.sessionsPerWeekMin}
            onChange={(next) => {
              if (next === undefined) return;
              const sessionsPerWeekMin = next;
              const sessionsPerWeekMax = Math.max(sessionsPerWeekMin, draft.sessionsPerWeekMax);
              update({ sessionsPerWeekMin, sessionsPerWeekMax });
            }}
          />
          <SessionsPerWeekField
            label="Max times per week (1–14)"
            value={draft.sessionsPerWeekMax}
            onChange={(next) => {
              if (next === undefined) return;
              const sessionsPerWeekMax = next;
              const sessionsPerWeekMin = Math.min(draft.sessionsPerWeekMin, sessionsPerWeekMax);
              update({ sessionsPerWeekMin, sessionsPerWeekMax });
            }}
          />
        </div>
      );
    case "session-length":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 text-xs">
            <span className="font-medium">Min (inner workout)</span>
            <DurationField
              value={draft.sessionMinutesMin}
              onChange={(v) => {
                if (v === undefined) return;
                const sessionMinutesMin = Math.max(1, Math.min(240, v));
                const sessionMinutesMax = Math.max(sessionMinutesMin, draft.sessionMinutesMax);
                update({ sessionMinutesMin, sessionMinutesMax });
              }}
              hint="Daily floor per scheduled session (before drive padding)."
              sliderMinMinutes={15}
              sliderMaxMinutes={240}
            />
          </div>
          <div className="flex flex-col gap-1 text-xs">
            <span className="font-medium">Max (inner workout)</span>
            <DurationField
              value={draft.sessionMinutesMax}
              onChange={(v) => {
                if (v === undefined) return;
                const sessionMinutesMax = Math.max(1, Math.min(240, v));
                const sessionMinutesMin = Math.min(draft.sessionMinutesMin, sessionMinutesMax);
                update({ sessionMinutesMin, sessionMinutesMax });
              }}
              hint="Upper length for a single workout block."
              sliderMinMinutes={15}
              sliderMaxMinutes={240}
            />
          </div>
        </div>
      );
    case "min-block":
      return (
        <DurationField
          value={draft.minMinutesPerBlock}
          onChange={(v) =>
            update({ minMinutesPerBlock: v === undefined ? undefined : Math.max(15, v) })
          }
          hint="Auto blocks prefer at least this long while demand remains; small gaps are skipped until the end. With only min block set, the planner allows up to 2 auto blocks per day (e.g. work → gym → work)."
          sliderMinMinutes={15}
          sliderMaxMinutes={8 * 60}
        />
      );
    case "max-blocks-day": {
      const v = draft.maxAutoBlocksPerDay;
      return (
        <div className="flex flex-col gap-1 text-xs">
          <label className="flex flex-col gap-1">
            <span>Max auto blocks per calendar day (1–8)</span>
            <input
              type="number"
              min={1}
              max={8}
              className="field max-w-[8rem] tabular-nums"
              value={v === undefined ? "" : String(v)}
              placeholder="2 (default with min block)"
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw === "") {
                  update({ maxAutoBlocksPerDay: undefined });
                  return;
                }
                const n = Number(raw);
                if (!Number.isFinite(n)) return;
                update({ maxAutoBlocksPerDay: Math.min(8, Math.max(1, Math.round(n))) });
              }}
            />
          </label>
          <p className="text-[11px] text-ink-400">
            Leave empty to use the planner default (2 when min block size is set).
          </p>
        </div>
      );
    }
    case "days":
      return (
        <WeekdayToggleGrid
          selected={draft.plannerDaysOfWeek?.length ? draft.plannerDaysOfWeek : undefined}
          onChange={(next) =>
            update({
              plannerDaysOfWeek: next && next.length > 0 ? next : undefined
            })
          }
        />
      );
    case "ideal-start-times": {
      const clocks = normaliseIdealClockTimes(draft.idealBlockTimes, { hour: 12, minute: 0 });
      return (
        <div className="flex flex-col gap-2">
          <IdealClockTimesField
            value={clocks}
            onChange={(idealBlockTimes) => update({ idealBlockTimes })}
          />
          <p className="text-[11px] text-ink-400">
            Nudges gap choice toward starting near these clocks when the gap allows.
          </p>
        </div>
      );
    }
    case "ideal-after-local": {
      const b = normalisePlacementIdealClockBoundary(draft.earliestStart);
      return (
        <IdealPlacementClockAfterField
          value={b}
          onChange={(next) =>
            update({
              earliestStart: normalisePlacementIdealClockBoundary(next)
            })
          }
        />
      );
    }
    case "ideal-before-local": {
      const b = normalisePlacementIdealClockBoundary(draft.latestEnd);
      return (
        <IdealPlacementClockBeforeField
          value={b}
          onChange={(next) =>
            update({
              latestEnd: normalisePlacementIdealClockBoundary(next)
            })
          }
        />
      );
    }
  }
}

export function PhysicalActivityConstraintEditor({
  draft,
  onChange
}: {
  draft: PhysicalRoutineDraft;
  onChange: (next: PhysicalRoutineDraft) => void;
}) {
  const update = (changes: Partial<PhysicalRoutineDraft>) => {
    const n = { ...draft, ...changes };
    if (n.sessionsPerWeekMin > n.sessionsPerWeekMax) {
      n.sessionsPerWeekMax = n.sessionsPerWeekMin;
    }
    if (n.sessionMinutesMin > n.sessionMinutesMax) {
      n.sessionMinutesMax = n.sessionMinutesMin;
    }
    onChange(n);
  };

  const setConstraints = useMemo(
    () => gymConstraintDefs.filter((c) => c.isSet(draft)),
    [draft]
  );
  const unsetConstraints = useMemo(
    () => gymConstraintDefs.filter((c) => !c.isSet(draft)),
    [draft]
  );

  const clearAllRemovable = () => {
    let next = draft;
    for (const c of setConstraints) {
      if (!c.removable) continue;
      next = { ...next, ...c.clear(next) };
    }
    onChange(next);
  };

  const removableActive = setConstraints.filter((c) => c.removable);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-ink-400">
        Same layout as Perfect Week: cadence is always on; tap + Add for optional placement hints.
      </p>
      {removableActive.length > 0 ? (
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={clearAllRemovable}
            className="rounded-full border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:border-accent hover:text-accent dark:border-ink-600 dark:text-ink-200"
          >
            Clear constraints
          </button>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {setConstraints.map((c) => (
          <ConstraintCard
            key={c.id}
            label={c.label}
            onRemove={c.removable ? () => update(c.clear(draft)) : undefined}
          >
            <GymConstraintBody id={c.id} draft={draft} update={update} />
          </ConstraintCard>
        ))}
      </div>

      {unsetConstraints.length > 0 ? (
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
      ) : null}
    </div>
  );
}
