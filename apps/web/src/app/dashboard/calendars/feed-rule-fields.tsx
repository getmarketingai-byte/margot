import type { IcsFeedRulesInclude } from "@calendar-automations/schema";

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

export function FeedRuleFields(props: {
  defaults?: IcsFeedRulesInclude;
  goalOptions: readonly { id: string; title: string }[];
  groupOptions: readonly { id: string; title: string }[];
}) {
  const inc = props.defaults ?? {};
  const selGoals = inc.goalIds ?? [];
  const selGroups = inc.groupIds ?? [];

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
          defaultChecked={Boolean(inc.allGoalsAndSegments)}
        />
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

      {props.goalOptions.length ? (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-600 dark:text-ink-300">
            Individual goals (optional)
          </span>
          <select
            name="goalIds"
            multiple
            className="field min-h-[140px]"
            defaultValue={selGoals}
          >
            {props.goalOptions.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
          <span className="text-xs text-ink-500">Hold Cmd/Ctrl to select several.</span>
        </label>
      ) : (
        <p className="text-xs text-ink-500">Add weekly goals on the Planner to target specific goals.</p>
      )}

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
