import type { Hp6HabitKey, SchedulerFrameworkInclusionKey, UserSettings } from "@calendar-automations/schema";
import { FRAMEWORK_REGISTRY_DEFAULT_LABELS, schedulerFrameworkInclusionKeys } from "@calendar-automations/schema";

const SCHEDULER_KEY_TO_REGISTRY_ID: Record<SchedulerFrameworkInclusionKey, keyof typeof FRAMEWORK_REGISTRY_DEFAULT_LABELS> =
  {
    commitment: "commitment",
    polarity: "polarity",
    attention: "attention",
    workLayer: "workLayer",
    wheel: "wheel",
    ppfPillar: "ppfPillar",
    ppfHorizon: "ppfHorizon",
    hp6: "hp6"
  };

const HP6_LABELS: Record<Hp6HabitKey, string> = {
  clarity: "Seek clarity",
  energy: "Generate energy",
  necessity: "Raise necessity",
  productivity: "Increase productivity",
  influence: "Develop influence",
  courage: "Demonstrate courage"
};

function energyOrderingLabel(mode: UserSettings["energyOrdering"]["mode"]): string {
  switch (mode) {
    case "strict":
      return "Strict — refuse scanning before warm-up";
    case "ignore":
      return "Ignore — purely chronological";
    default:
      return "Balanced — prefer the curve";
  }
}

export function FrameworkRulesReview({
  schedulerFrameworkInclusion,
  wheel,
  ppf,
  hpp,
  energyOrdering
}: {
  schedulerFrameworkInclusion: UserSettings["schedulerFrameworkInclusion"];
  wheel: UserSettings["wheel"];
  ppf: UserSettings["ppf"];
  hpp: UserSettings["hpp"];
  energyOrdering: UserSettings["energyOrdering"];
}) {
  const activeFrameworks = schedulerFrameworkInclusionKeys
    .filter((k) => schedulerFrameworkInclusion[k])
    .map((k) => FRAMEWORK_REGISTRY_DEFAULT_LABELS[SCHEDULER_KEY_TO_REGISTRY_ID[k]]);

  return (
    <div className="card flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold">Active framework signals</h3>
        <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
          Snapshot of enabled frameworks and their numeric pairing. Enable frameworks under{" "}
          <a className="underline" href="#planner-tag">
            Tag goals
          </a>
          ; adjust numbers in the forms below. Global mechanics:{" "}
          <a className="underline" href="#planner-scheduling">
            Scheduling
          </a>
          .
        </p>
      </div>
      {activeFrameworks.length === 0 ? (
        <p className="text-xs text-ink-500 dark:text-ink-300">
          No frameworks in the allocator yet — add frameworks in Framework system to unlock tagging.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {activeFrameworks.map((label) => (
            <li
              key={label}
              className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-ink-800 dark:text-ink-100"
            >
              {label}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 border-t border-ink-200 pt-3 text-xs dark:border-ink-600 sm:grid-cols-2">
        <div>
          <div className="font-medium text-ink-700 dark:text-ink-200">Energy ordering (hour curve)</div>
          <p className="mt-1 text-[11px] text-ink-500 dark:text-ink-400">
            {energyOrderingLabel(energyOrdering.mode)}
          </p>
        </div>
        <div className="min-w-0 sm:text-right">
          <div className="font-medium text-ink-700 dark:text-ink-200">Wheel &amp; PPF</div>
          <p className="mt-1 text-[11px] text-ink-500 dark:text-ink-400">
            {wheel.areas.filter((a) => a.minMinutesPerWeek > 0).length} wheel floor(s); PPF min % sum{" "}
            {ppf.targets.reduce((s, t) => s + t.minPercent, 0)}
            %
          </p>
        </div>
      </div>

      <details className="rounded-md border border-ink-200/90 dark:border-ink-600">
        <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-ink-500 dark:text-ink-400">
          Numeric detail (read-only)
        </summary>
        <div className="space-y-3 border-t border-ink-200 px-3 py-3 dark:border-ink-600">
          <div>
            <div className="text-[11px] font-semibold text-ink-600 dark:text-ink-300">Wheel areas</div>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-ink-500 dark:text-ink-400">
              {wheel.areas.map((a) => (
                <li key={a.id}>
                  {a.label}: score {a.score}, min {a.minMinutesPerWeek} min/wk
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-ink-600 dark:text-ink-300">PPF mix</div>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-ink-500 dark:text-ink-400">
              {ppf.targets.map((t) => (
                <li key={t.pillar} className="capitalize">
                  {t.pillar}: {t.minPercent}% min · {t.minTouchesPerWeek} touches/wk
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[11px] font-semibold text-ink-600 dark:text-ink-300">HP6 touches / month</div>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-ink-500 dark:text-ink-400">
              {(() => {
                const entries = Object.entries(hpp.hp6MinTouchesPerMonth) as [Hp6HabitKey, number][];
                const nonZero = entries.filter(([, n]) => n > 0);
                if (nonZero.length === 0) {
                  return <li>All habits at 0 minimum</li>;
                }
                return nonZero.map(([k, n]) => (
                  <li key={k}>
                    {HP6_LABELS[k]}: {n}/mo
                  </li>
                ));
              })()}
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}
