"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

export type SchedulerFrameworkKey = "wheel" | "ppf" | "hpp";

interface Row {
  key: SchedulerFrameworkKey;
  title: string;
  description: string;
}

const ROWS: Row[] = [
  {
    key: "wheel",
    title: "Wheel of Life",
    description:
      "When on, weekly area floors from Scheduling rules apply and the allocator can add wheel top-ups."
  },
  {
    key: "ppf",
    title: "PPF (pillars & mix)",
    description:
      "When on, pillar tags drive mix metrics and minimum-percent / touch rules from Scheduling rules."
  },
  {
    key: "hpp",
    title: "HP6 habits",
    description:
      "When on, habit tags align with HP6 minimums in Scheduling rules (monthly touches)."
  }
];

export function FrameworkSchedulerToggles(props: {
  wheel: boolean;
  ppf: boolean;
  hpp: boolean;
  save: (framework: SchedulerFrameworkKey, enabled: boolean) => Promise<void>;
}) {
  const [wheel, setWheel] = useState(props.wheel);
  const [ppf, setPpf] = useState(props.ppf);
  const [hpp, setHpp] = useState(props.hpp);
  const [, startTransition] = useTransition();

  const externalSig = useMemo(
    () => `${props.wheel}:${props.ppf}:${props.hpp}`,
    [props.wheel, props.ppf, props.hpp]
  );
  useEffect(() => {
    setWheel(props.wheel);
    setPpf(props.ppf);
    setHpp(props.hpp);
  }, [externalSig, props.wheel, props.ppf, props.hpp]);

  const setForKey = (key: SchedulerFrameworkKey, enabled: boolean) => {
    if (key === "wheel") setWheel(enabled);
    else if (key === "ppf") setPpf(enabled);
    else setHpp(enabled);
  };

  const valueForKey = (key: SchedulerFrameworkKey) =>
    key === "wheel" ? wheel : key === "ppf" ? ppf : hpp;

  const toggle = (key: SchedulerFrameworkKey, enabled: boolean) => {
    const prev = valueForKey(key);
    setForKey(key, enabled);
    startTransition(async () => {
      try {
        await props.save(key, enabled);
      } catch (err) {
        console.error("framework scheduler toggle failed", err);
        setForKey(key, prev);
      }
    });
  };

  return (
    <section className="card flex flex-col gap-3" aria-labelledby="scheduler-frameworks-heading">
      <div>
        <h2 id="scheduler-frameworks-heading" className="text-sm font-semibold">
          Frameworks in the scheduler
        </h2>
        <p className="text-xs text-ink-400">
          Turn each balance layer on or off for allocation and metrics. Boards below follow the same
          switches; detailed floors and targets stay in{" "}
          <a className="underline" href="#scheduling-constraints">
            Scheduling rules
          </a>
          .
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {ROWS.map((row) => {
          const checked = valueForKey(row.key);
          return (
            <li key={row.key}>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200 p-3 dark:border-ink-600">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink-300 text-accent focus:ring-accent"
                  checked={checked}
                  onChange={(e) => toggle(row.key, e.target.checked)}
                />
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-ink-800 dark:text-ink-100">
                    {row.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-500 dark:text-ink-300">
                    {row.description}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
