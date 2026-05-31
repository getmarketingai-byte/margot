import type { IcsFeedRulesInclude } from "@margot/schema";

function LabeledCheckbox(props: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex cursor-pointer flex-col gap-0.5 text-sm leading-snug">
      <span className="flex items-center gap-2">
        <input
          type="checkbox"
          name={props.name}
          value="on"
          defaultChecked={props.defaultChecked}
        />
        {props.label}
      </span>
      {props.hint ? <span className="text-xs text-ink-500 dark:text-ink-400 pl-6">{props.hint}</span> : null}
    </label>
  );
}

function GoalOrSegmentPick(props: {
  value: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm leading-snug">
      <input
        type="checkbox"
        name="goalIds"
        value={props.value}
        defaultChecked={props.defaultChecked}
      />
      {props.label}
    </label>
  );
}

export function FeedRuleFields(props: {
  defaults?: IcsFeedRulesInclude;
  goalOptions: readonly { id: string; title: string }[];
  /** IDs must be `segment:<segmentId>` to match ICS tags for reserved segment blocks. */
  segmentOptions: readonly { id: string; title: string }[];
  groupOptions: readonly { id: string; title: string }[];
}) {
  const inc = props.defaults ?? {};
  const selGoals = new Set(inc.goalIds ?? []);
  const selGroups = inc.groupIds ?? [];
  const hasPickList = props.goalOptions.length > 0 || props.segmentOptions.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2 rounded-md border border-ink-200 p-3 dark:border-ink-600">
        <legend className="px-1 text-xs font-semibold text-ink-600 dark:text-ink-300">
          Schedule categories
        </legend>
        <p className="text-xs text-ink-500 dark:text-ink-400 pl-0.5 -mt-1">
          A feed shows every event matching <strong>any</strong> box you tick (union).
        </p>
        <LabeledCheckbox
          name="allGoalsAndSegments"
          label="All goal blocks & consistency segments"
          hint="Turn this off to choose specific weekly goals and segments below."
          defaultChecked={Boolean(inc.allGoalsAndSegments)}
        />
        {hasPickList ? (
          <div className="ml-1 flex flex-col gap-2 border-l-2 border-ink-200 pl-3 dark:border-ink-600">
            <p className="text-xs text-ink-500 dark:text-ink-400">
              When &quot;All goal blocks &amp; consistency segments&quot; is off, only checked items
              in this list contribute goal-like events (plus any goal groups you select further down).
            </p>
            {props.goalOptions.length ? (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                  Weekly goals
                </span>
                <div className="flex flex-col gap-1">
                  {props.goalOptions.map((g) => (
                    <GoalOrSegmentPick
                      key={g.id}
                      value={g.id}
                      label={g.title}
                      defaultChecked={selGoals.has(g.id)}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            {props.segmentOptions.length ? (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                  Consistency segments
                </span>
                <div className="flex flex-col gap-1">
                  {props.segmentOptions.map((s) => (
                    <GoalOrSegmentPick
                      key={s.id}
                      value={s.id}
                      label={s.title}
                      defaultChecked={selGoals.has(s.id)}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-ink-500 dark:text-ink-400 pl-0.5">
            Add weekly goals on the Planner or consistency segments in Settings to cherry-pick
            individual blocks; until then, use the &quot;all&quot; option above for every goal-like
            event.
          </p>
        )}
        <LabeledCheckbox
          name="sleep"
          label="Sleep"
          defaultChecked={Boolean(inc.sleep)}
        />
        <LabeledCheckbox
          name="routine"
          label="Morning & shutdown routines"
          defaultChecked={Boolean(inc.routine)}
        />
        <LabeledCheckbox
          name="genericTravel"
          label="Travel / drive blocks (excluding gym commute pads)"
          defaultChecked={Boolean(inc.genericTravel)}
        />
        <LabeledCheckbox
          name="gymGoals"
          label="Gym goal sessions"
          hint="Goals with the gym preset"
          defaultChecked={Boolean(inc.gymGoals)}
        />
        <LabeledCheckbox
          name="gymPads"
          label="Gym commute pads"
          hint="Drive time before / after gym goals"
          defaultChecked={Boolean(inc.gymPads)}
        />
        <LabeledCheckbox
          name="weatherTimemap"
          label="Weather (nice-day) windows"
          defaultChecked={Boolean(inc.weatherTimemap)}
        />
        <LabeledCheckbox
          name="invertedTimemap"
          label="Inverted timemap (calendar availability readout)"
          defaultChecked={Boolean(inc.invertedTimemap)}
        />
        <LabeledCheckbox
          name="weeklyReview"
          label="Weekly review"
          defaultChecked={Boolean(inc.weeklyReview)}
        />
        <LabeledCheckbox
          name="monthlyStrategy"
          label="Monthly strategy"
          defaultChecked={Boolean(inc.monthlyStrategy)}
        />
        <LabeledCheckbox
          name="errand"
          label="Errands"
          defaultChecked={Boolean(inc.errand)}
        />
      </fieldset>

      {props.groupOptions.length ? (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-600 dark:text-ink-300">
            Goal groups (optional)
          </span>
          <select
            name="groupIds"
            multiple
            className="field min-h-[100px]"
            defaultValue={selGroups}
          >
            {props.groupOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
