"use client";

import { useEffect, useState, useTransition } from "react";
import type { GoalGroup, WeeklyGoal } from "@calendar-automations/schema";
import {
  effectivePlacementIdealAfterBoundary,
  effectivePlacementIdealBeforeBoundary,
  normalisePlacementIdealClockBoundary,
  stubWeeklyGoalFromGoalGroup
} from "@calendar-automations/schema";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ConstraintCard,
  IdealClockTimesField,
  IdealPlacementClockAfterField,
  IdealPlacementClockBeforeField,
  normaliseIdealClockTimes,
  SessionsPerWeekField,
  WeekdayToggleGrid
} from "@/components/scheduling-constraints";
import {
  chipsForGoal,
  formatMinutes,
  summariseAllocation
} from "../plan/goal-helpers";
import { upsertGoalGroup, removeGoalGroup, patchGoal } from "../plan/actions";

type GroupDraft = Omit<GoalGroup, "id" | "title">;

function emptyDraft(): GroupDraft {
  return {};
}

function DurationField({
  value,
  onChange,
  hint,
  sliderMinMinutes,
  sliderMaxMinutes
}: {
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  hint?: string;
  sliderMinMinutes?: number;
  sliderMaxMinutes?: number;
}) {
  const [unit, setUnit] = useState<"hours" | "minutes">("hours");
  const display =
    value === undefined ? "" : unit === "hours" ? String(value / 60) : String(value);
  const onInput = (raw: string) => {
    if (raw === "") return onChange(undefined);
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onChange(Math.max(0, Math.round(unit === "hours" ? n * 60 : n)));
  };
  const min = sliderMinMinutes ?? 0;
  const max = sliderMaxMinutes ?? 40 * 60;
  const thumb = Math.min(max, Math.max(min, value ?? 0));
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <input
          type="number"
          min={0}
          step={unit === "hours" ? 0.25 : 15}
          value={display}
          onChange={(e) => onInput(e.target.value)}
          className="field !w-auto min-w-[6rem] flex-1 basis-0 tabular-nums"
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as "hours" | "minutes")}
          className="field !w-auto shrink-0"
          aria-label="Unit"
        >
          <option value="hours">h</option>
          <option value="minutes">m</option>
        </select>
      </div>
      {value !== undefined ? (
        <p className="text-[11px] font-medium tabular-nums text-ink-700 dark:text-ink-200">
          {formatMinutes(value)}
        </p>
      ) : (
        <p className="text-[11px] text-ink-400">No duration set</p>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={5}
        value={thumb}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer accent-accent"
        aria-valuetext={value !== undefined ? formatMinutes(value) : undefined}
      />
      {hint ? <span className="text-[11px] text-ink-400">{hint}</span> : null}
    </div>
  );
}

export function GoalGroupsPanel(props: {
  initialGoalGroups: GoalGroup[];
  schedulingGoals: WeeklyGoal[];
  /** Full-week capacity minutes for share hints (same as Plan page). */
  freeMinutesThisWeek: number;
}) {
  const { initialGoalGroups, schedulingGoals, freeMinutesThisWeek } = props;
  const [groups, setGroups] = useState<GoalGroup[]>(() => [...initialGoalGroups]);
  const [, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    setGroups([...initialGoalGroups]);
  }, [initialGoalGroups]);

  const persistGroup = (full: GoalGroup) => {
    startTransition(() => {
      void upsertGoalGroup(full)
        .then(() => router.refresh())
        .catch((e) => console.error(e));
    });
  };

  const addGroup = () => {
    const id = crypto.randomUUID();
    const next: GoalGroup = { id, title: "New group", ...emptyDraft() };
    setGroups((prev) => [...prev, next]);
    persistGroup(next);
  };

  const deleteGroup = (id: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== id));
    startTransition(() => {
      void removeGoalGroup(id)
        .then(() => router.refresh())
        .catch((e) => console.error(e));
    });
  };

  const updateGroupField = (id: string, patch: Partial<GoalGroup>) => {
    setGroups((prev) => {
      const next = prev.map((g) => (g.id === id ? { ...g, ...patch } : g));
      const row = next.find((g) => g.id === id);
      if (row) persistGroup(row);
      return next;
    });
  };

  const toggleMember = (goalId: string, groupId: string, member: boolean) => {
    const goal = schedulingGoals.find((g) => g.id === goalId);
    if (!goal) return;
    const cur = goal.groupIds ?? [];
    const nextIds = member ? [...new Set([...cur, groupId])] : cur.filter((id) => id !== groupId);
    startTransition(() => {
      void patchGoal(goalId, {
        groupIds: nextIds.length ? nextIds : undefined
      })
        .then(() => router.refresh())
        .catch((e) => console.error(e));
    });
  };

  return (
    <div className="flex flex-col gap-4 border-t border-ink-200 pt-5 dark:border-ink-600">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Goal groups</h3>
          <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
            Named cohorts with the same scheduling fields as goals — limits apply to the{" "}
            <strong>sum</strong> of member goals each week / day. Manage membership per goal below;
            edit constraints on{" "}
            <Link className="underline" href="/dashboard/plan">
              My Perfect Week
            </Link>{" "}
            via <strong>group chips</strong> or here.
          </p>
        </div>
        <button type="button" className="btn-secondary text-xs" onClick={addGroup}>
          Add group
        </button>
      </header>

      {groups.length === 0 ? (
        <p className="text-xs text-ink-400">
          No groups yet. Add one to cap aggregate screen time, work blocks, etc.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {groups.map((g) => (
            <li key={g.id} className="card flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs">
                  <span className="text-ink-500 dark:text-ink-400">Title</span>
                  <input
                    type="text"
                    defaultValue={g.title}
                    key={`${g.id}-title`}
                    onBlur={(e) => {
                      const t = e.target.value.trim() || "Untitled group";
                      if (t !== g.title) updateGroupField(g.id, { title: t });
                    }}
                    className="field"
                  />
                </label>
                <button
                  type="button"
                  className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                  onClick={() => deleteGroup(g.id)}
                >
                  Remove group
                </button>
              </div>

              <div className="flex flex-wrap gap-1">
                {chipsForGoal(stubWeeklyGoalFromGoalGroup(g)).map((c) => (
                  <span
                    key={c.key}
                    className="rounded-full border border-ink-200 px-2 py-0.5 text-[11px] dark:border-ink-600"
                  >
                    {c.label}
                  </span>
                ))}
              </div>

              <GroupConstraintEditors
                group={g}
                freeMinutesThisWeek={freeMinutesThisWeek}
                onPatch={(p) => updateGroupField(g.id, p)}
              />

              <div className="border-t border-ink-100 pt-3 dark:border-ink-700">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  Members
                </p>
                <ul className="flex flex-col gap-1.5">
                  {schedulingGoals.map((goal) => (
                    <li key={goal.id} className="flex items-center gap-2 text-xs">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={goal.groupIds?.includes(g.id) ?? false}
                          onChange={(e) => toggleMember(goal.id, g.id, e.target.checked)}
                        />
                        <span>{goal.title}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GroupConstraintEditors({
  group,
  freeMinutesThisWeek,
  onPatch
}: {
  group: GoalGroup;
  freeMinutesThisWeek: number;
  onPatch: (p: Partial<GoalGroup>) => void;
}) {
  const stub = stubWeeklyGoalFromGoalGroup(group);
  const summary = summariseAllocation([stub], freeMinutesThisWeek);
  const defaultPct =
    freeMinutesThisWeek > 0
      ? Math.max(
          1,
          Math.min(100, Math.round((summary.equalSliceOfWeekMinutes / freeMinutesThisWeek) * 100))
        )
      : 25;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ConstraintCard
        label="Weekly floor"
        onRemove={() =>
          onPatch({
            minMinutesPerWeek: undefined,
            minMinutesPerWeekNonNegotiable: undefined
          })
        }
      >
        <DurationField
          value={group.minMinutesPerWeek}
          onChange={(minMinutesPerWeek) =>
            onPatch({
              minMinutesPerWeek,
              ...(minMinutesPerWeek === undefined ? { minMinutesPerWeekNonNegotiable: undefined } : {})
            })
          }
          hint="Minimum aggregate minutes / week across members."
          sliderMinMinutes={0}
          sliderMaxMinutes={48 * 60}
        />
        {group.minMinutesPerWeek !== undefined ? (
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-ink-600 dark:text-ink-300">
            <input
              type="checkbox"
              checked={group.minMinutesPerWeekNonNegotiable === true}
              onChange={(e) =>
                onPatch({
                  minMinutesPerWeekNonNegotiable: e.target.checked ? true : undefined
                })
              }
              className="mt-0.5"
            />
            <span title="Reserve this minimum in free time before other goals; on travel days, overlay on busy if needed.">
              Non-negotiable (weekly floor)
            </span>
          </label>
        ) : null}
      </ConstraintCard>
      <ConstraintCard label="Weekly ceiling" onRemove={() => onPatch({ maxMinutesPerWeek: undefined })}>
        <DurationField
          value={group.maxMinutesPerWeek}
          onChange={(v) => onPatch({ maxMinutesPerWeek: v === undefined ? undefined : Math.max(1, v) })}
          hint="Maximum aggregate minutes / week."
          sliderMinMinutes={1}
          sliderMaxMinutes={48 * 60}
        />
      </ConstraintCard>
      <ConstraintCard
        label="Daily floor"
        onRemove={() =>
          onPatch({
            minMinutesPerDay: undefined,
            minMinutesPerDayNonNegotiable: undefined
          })
        }
      >
        <DurationField
          value={group.minMinutesPerDay}
          onChange={(minMinutesPerDay) =>
            onPatch({
              minMinutesPerDay,
              ...(minMinutesPerDay === undefined ? { minMinutesPerDayNonNegotiable: undefined } : {})
            })
          }
          sliderMinMinutes={0}
          sliderMaxMinutes={24 * 60}
        />
        {group.minMinutesPerDay !== undefined ? (
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-ink-600 dark:text-ink-300">
            <input
              type="checkbox"
              checked={group.minMinutesPerDayNonNegotiable === true}
              onChange={(e) =>
                onPatch({
                  minMinutesPerDayNonNegotiable: e.target.checked ? true : undefined
                })
              }
              className="mt-0.5"
            />
            <span title="Reserve this minimum in free time before other goals; on travel days, overlay on busy if needed.">
              Non-negotiable (daily floor)
            </span>
          </label>
        ) : null}
      </ConstraintCard>
      <ConstraintCard label="Daily cap" onRemove={() => onPatch({ maxMinutesPerDay: undefined })}>
        <DurationField
          value={group.maxMinutesPerDay}
          onChange={(v) => onPatch({ maxMinutesPerDay: v === undefined ? undefined : Math.max(1, v) })}
          hint="Aggregate cap on members per calendar day."
          sliderMinMinutes={1}
          sliderMaxMinutes={24 * 60}
        />
      </ConstraintCard>
      <ConstraintCard
        label="% of full-week time"
        onRemove={() => onPatch({ allocationSharePercent: undefined })}
      >
        <label className="flex flex-col gap-1 text-xs">
          <span>Percent (1–100)</span>
          <input
            type="number"
            min={1}
            max={100}
            value={group.allocationSharePercent ?? ""}
            onChange={(e) => {
              if (e.target.value === "") return onPatch({ allocationSharePercent: undefined });
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              onPatch({ allocationSharePercent: Math.min(100, Math.max(1, Math.round(n))) });
            }}
            placeholder={String(defaultPct)}
            className="field"
          />
        </label>
        <p className="text-[11px] text-ink-400">
          Same denominator as goal rows — caps aggregate weekly targets as a share of full-week
          schedulable time after segments ({formatMinutes(freeMinutesThisWeek)} this week).
        </p>
      </ConstraintCard>
      <ConstraintCard
        label="Sessions / week"
        onRemove={() =>
          onPatch({
            frequencyPerWeek: undefined,
            frequencyPerWeekMin: undefined,
            frequencyPerWeekMax: undefined
          })
        }
      >
        <SessionsPerWeekField
          minValue={group.frequencyPerWeekMin ?? group.frequencyPerWeek}
          maxValue={group.frequencyPerWeekMax ?? group.frequencyPerWeek}
          onChange={({ min, max }) => {
            if (min === max) {
              onPatch({
                frequencyPerWeek: min,
                frequencyPerWeekMin: undefined,
                frequencyPerWeekMax: undefined
              });
            } else {
              onPatch({
                frequencyPerWeek: undefined,
                frequencyPerWeekMin: min,
                frequencyPerWeekMax: max
              });
            }
          }}
        />
      </ConstraintCard>
      <ConstraintCard label="Pinned weekdays" className="sm:col-span-2" onRemove={() => onPatch({ daysOfWeek: undefined })}>
        <WeekdayToggleGrid
          selected={group.daysOfWeek}
          onChange={(next) => onPatch({ daysOfWeek: next?.length ? next : undefined })}
        />
      </ConstraintCard>
      <ConstraintCard label="Earliest hour" onRemove={() => onPatch({ earliestHour: undefined })}>
        <input
          type="number"
          min={0}
          max={23}
          value={group.earliestHour ?? ""}
          onChange={(e) =>
            onPatch({
              earliestHour: e.target.value === "" ? undefined : Number(e.target.value)
            })
          }
          className="field text-xs"
        />
      </ConstraintCard>
      <ConstraintCard label="Latest hour (exclusive)" onRemove={() => onPatch({ latestHour: undefined })}>
        <input
          type="number"
          min={0}
          max={24}
          value={group.latestHour ?? ""}
          onChange={(e) =>
            onPatch({
              latestHour: e.target.value === "" ? undefined : Number(e.target.value)
            })
          }
          className="field text-xs"
        />
      </ConstraintCard>
      <ConstraintCard label="Nice weather only" onRemove={() => onPatch({ scheduleInNiceWeather: undefined })}>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={group.scheduleInNiceWeather === true}
            onChange={(e) => onPatch({ scheduleInNiceWeather: e.target.checked ? true : undefined })}
          />
          Place members only in outside / forecast windows (same as goals).
        </label>
      </ConstraintCard>
      <ConstraintCard
        label="Ideal start times"
        className="sm:col-span-2"
        onRemove={() => onPatch({ placementIdealClockTimes: undefined })}
      >
        <IdealClockTimesField
          value={normaliseIdealClockTimes(group.placementIdealClockTimes, { hour: 12, minute: 0 })}
          onChange={(placementIdealClockTimes) => onPatch({ placementIdealClockTimes })}
        />
      </ConstraintCard>
      <ConstraintCard
        label="Ideal times — after (local)"
        onRemove={() =>
          onPatch({
            placementIdealClockAfter: undefined,
            placementIdealClockFilter:
              group.placementIdealClockFilter?.kind === "before"
                ? group.placementIdealClockFilter
                : undefined
          })
        }
      >
        <IdealPlacementClockAfterField
          value={effectivePlacementIdealAfterBoundary(group)}
          onChange={(next) =>
            onPatch({
              placementIdealClockAfter: normalisePlacementIdealClockBoundary(next),
              placementIdealClockFilter:
                group.placementIdealClockFilter?.kind === "before"
                  ? group.placementIdealClockFilter
                  : undefined
            })
          }
        />
      </ConstraintCard>
      <ConstraintCard
        label="Ideal times — before (local)"
        onRemove={() =>
          onPatch({
            placementIdealClockBefore: undefined,
            placementIdealClockFilter:
              group.placementIdealClockFilter?.kind === "after"
                ? group.placementIdealClockFilter
                : undefined
          })
        }
      >
        <IdealPlacementClockBeforeField
          value={effectivePlacementIdealBeforeBoundary(group)}
          onChange={(next) =>
            onPatch({
              placementIdealClockBefore: normalisePlacementIdealClockBoundary(next),
              placementIdealClockFilter:
                group.placementIdealClockFilter?.kind === "after"
                  ? group.placementIdealClockFilter
                  : undefined
            })
          }
        />
      </ConstraintCard>
    </div>
  );
}
