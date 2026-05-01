import type { PpfPillarKey, UserSettings } from "@calendar-automations/schema";
import { frameworkRuleFormPillarKeys } from "./framework-rule-form-shared";
import { updatePpf } from "./framework-rules-actions";

export function PpfMixForm({
  targets
}: {
  targets: UserSettings["ppf"]["targets"];
}) {
  const pillars = frameworkRuleFormPillarKeys;
  return (
    <details className="card">
      <summary className="cursor-pointer text-sm font-semibold">
        Personal / Professional / Financial mix
      </summary>
      <p className="mt-1 text-xs text-ink-400">
        Set minimum percent of allocated time per pillar and minimum touches per week.
      </p>
      <form action={updatePpf} className="mt-3 grid gap-3 sm:grid-cols-3">
        {pillars.map((p: PpfPillarKey) => {
          const target = targets.find((t) => t.pillar === p);
          return (
            <fieldset key={p} className="rounded border border-ink-200 p-2 dark:border-ink-600">
              <legend className="text-xs font-medium capitalize">{p}</legend>
              <label className="flex flex-col gap-1 text-xs">
                Min % of week
                <input
                  name={`pct_${p}`}
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={target?.minPercent ?? 0}
                  className="field"
                />
              </label>
              <label className="mt-2 flex flex-col gap-1 text-xs">
                Min touches / week
                <input
                  name={`touches_${p}`}
                  type="number"
                  min={0}
                  defaultValue={target?.minTouchesPerWeek ?? 0}
                  className="field"
                />
              </label>
            </fieldset>
          );
        })}
        <div className="sm:col-span-3">
          <button type="submit" className="btn-primary w-full text-xs">
            Save mix
          </button>
        </div>
      </form>
    </details>
  );
}
