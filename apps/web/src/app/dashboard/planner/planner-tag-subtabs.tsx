"use client";

import { useEffect, useState, type ReactNode } from "react";

type TagSubId = "frameworks" | "groups";

function hashNeedsFrameworksPanel(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hash.replace(/^#/, "");
  return h === "battery-curve-goals";
}

export function PlannerTagSubtabs(props: {
  frameworksPanel: ReactNode;
  goalGroupsPanel: ReactNode;
}) {
  const [sub, setSub] = useState<TagSubId>("frameworks");

  useEffect(() => {
    const sync = () => {
      if (hashNeedsFrameworksPanel()) setSub("frameworks");
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const btn =
    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Tag goals views"
        className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-lg border border-ink-200 bg-ink-50/50 p-1 dark:border-ink-600 dark:bg-ink-900/40"
      >
        <button
          type="button"
          role="tab"
          id="planner-tag-sub-frameworks"
          aria-selected={sub === "frameworks"}
          aria-controls="planner-tag-panel-frameworks"
          tabIndex={sub === "frameworks" ? 0 : -1}
          className={`${btn} ${
            sub === "frameworks"
              ? "bg-white text-ink-900 shadow-sm dark:bg-ink-800 dark:text-ink-50"
              : "text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-ink-100"
          }`}
          onClick={() => setSub("frameworks")}
        >
          Frameworks &amp; boards
        </button>
        <button
          type="button"
          role="tab"
          id="planner-tag-sub-groups"
          aria-selected={sub === "groups"}
          aria-controls="planner-tag-panel-groups"
          tabIndex={sub === "groups" ? 0 : -1}
          className={`${btn} ${
            sub === "groups"
              ? "bg-white text-ink-900 shadow-sm dark:bg-ink-800 dark:text-ink-50"
              : "text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-ink-100"
          }`}
          onClick={() => setSub("groups")}
        >
          Goal groups
        </button>
      </div>

      <div
        role="tabpanel"
        id="planner-tag-panel-frameworks"
        aria-labelledby="planner-tag-sub-frameworks"
        hidden={sub !== "frameworks"}
        className="flex min-h-0 flex-col gap-4"
      >
        {props.frameworksPanel}
      </div>
      <div
        role="tabpanel"
        id="planner-tag-panel-groups"
        aria-labelledby="planner-tag-sub-groups"
        hidden={sub !== "groups"}
        className="flex min-h-0 flex-col gap-4"
      >
        {props.goalGroupsPanel}
      </div>
    </div>
  );
}
