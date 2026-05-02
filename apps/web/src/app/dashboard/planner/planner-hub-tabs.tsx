"use client";

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode
} from "react";

export type PlannerTabId = "intent" | "scheduling" | "tag" | "rules";

const PRIMARY_TAB_HASH: Record<PlannerTabId, string> = {
  intent: "planner-intent",
  scheduling: "planner-scheduling",
  tag: "planner-tag",
  rules: "planner-rules"
};

/** Map URL fragment (no leading `#`) to primary tab and optional element to scroll into view. */
function parsePlannerHash(fragment: string): { tab: PlannerTabId; scrollToId?: string } {
  const h = fragment.replace(/^#/, "").trim();
  if (!h) return { tab: "intent" };

  if (h === PRIMARY_TAB_HASH.intent) return { tab: "intent" };
  if (h === PRIMARY_TAB_HASH.scheduling) return { tab: "scheduling" };
  if (h === PRIMARY_TAB_HASH.tag) return { tab: "tag" };
  if (h === PRIMARY_TAB_HASH.rules) return { tab: "rules" };

  const legacy: Record<string, PlannerTabId> = {
    "why-weekly-intent-heading": "intent",
    "scheduling-outcomes-heading": "scheduling",
    "scheduling-outcomes": "scheduling",
    "framework-system-heading": "tag",
    "framework-system": "tag",
    "battery-curve-goals": "tag",
    "framework-methods-heading": "rules",
    "framework-methods": "rules"
  };
  const tab = legacy[h];
  if (tab) return { tab, scrollToId: h };
  return { tab: "intent" };
}

function replacePlannerHash(nextFragment: string) {
  if (typeof window === "undefined") return;
  const path = `${window.location.pathname}${window.location.search}${nextFragment ? `#${nextFragment}` : ""}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== path) {
    window.history.replaceState(null, "", path);
  }
}

function scrollToPlannerTarget(id: string | undefined) {
  if (!id || typeof document === "undefined") return;
  queueMicrotask(() => {
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  });
}

export function PlannerHubTabs(props: {
  intentPanel: ReactNode;
  schedulingPanel: ReactNode;
  tagPanel: ReactNode;
  rulesPanel: ReactNode;
}) {
  const [tab, setTab] = useState<PlannerTabId>("intent");

  const applyHash = useCallback((rawHash: string) => {
    const { tab: nextTab, scrollToId } = parsePlannerHash(rawHash);
    setTab(nextTab);
    scrollToPlannerTarget(scrollToId);
  }, []);

  useEffect(() => {
    applyHash(window.location.hash);
  }, [applyHash]);

  useEffect(() => {
    const onHashChange = () => applyHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [applyHash]);

  function select(next: PlannerTabId) {
    setTab(next);
    replacePlannerHash(PRIMARY_TAB_HASH[next]);
  }

  const tabBtn =
    "shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors -mb-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

  const tabs: { id: PlannerTabId; label: string }[] = [
    { id: "intent", label: "Intent" },
    { id: "scheduling", label: "Scheduling" },
    { id: "tag", label: "Tag goals" },
    { id: "rules", label: "Rules" }
  ];

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Planner sections"
        className="-mx-1 flex gap-0.5 overflow-x-auto border-b border-ink-200 px-1 dark:border-ink-600 sm:mx-0 sm:flex-wrap sm:gap-1 sm:overflow-visible"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`planner-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`planner-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`${tabBtn} ${
              tab === t.id
                ? "border-accent text-ink-900 dark:text-ink-100"
                : "border-transparent text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200"
            }`}
            onClick={() => select(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="planner-panel-intent"
        aria-labelledby="planner-tab-intent"
        hidden={tab !== "intent"}
        className="flex flex-col gap-4"
      >
        {props.intentPanel}
      </div>
      <div
        role="tabpanel"
        id="planner-panel-scheduling"
        aria-labelledby="planner-tab-scheduling"
        hidden={tab !== "scheduling"}
        className="flex flex-col gap-4"
      >
        {props.schedulingPanel}
      </div>
      <div
        role="tabpanel"
        id="planner-panel-tag"
        aria-labelledby="planner-tab-tag"
        hidden={tab !== "tag"}
        className="flex flex-col gap-4"
      >
        {props.tagPanel}
      </div>
      <div
        role="tabpanel"
        id="planner-panel-rules"
        aria-labelledby="planner-tab-rules"
        hidden={tab !== "rules"}
        className="flex flex-col gap-4"
      >
        {props.rulesPanel}
      </div>
    </div>
  );
}
