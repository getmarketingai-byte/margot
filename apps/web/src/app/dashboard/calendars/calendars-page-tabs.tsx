"use client";

import { useEffect, useState, type ReactNode } from "react";

type TabId = "calendars" | "feeds";

export function CalendarsPageTabs(props: {
  calendarsPanel: ReactNode;
  feedsPanel: ReactNode;
}) {
  const [tab, setTab] = useState<TabId>("calendars");

  useEffect(() => {
    const syncFromHash = () => {
      setTab(window.location.hash === "#ical-feeds" ? "feeds" : "calendars");
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  function select(next: TabId) {
    setTab(next);
    if (typeof window === "undefined") return;
    const nextHash = next === "feeds" ? "#ical-feeds" : "";
    const path = `${window.location.pathname}${window.location.search}${nextHash}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== path) {
      window.history.replaceState(null, "", path);
    }
    if (next === "feeds") {
      requestAnimationFrame(() => {
        document.getElementById("ical-feeds")?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });
    }
  }

  const tabBtn =
    "border-b-2 px-3 py-2 text-sm font-medium transition-colors -mb-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Calendars and feeds"
        className="flex gap-1 border-b border-ink-200 dark:border-ink-600"
      >
        <button
          type="button"
          role="tab"
          id="tab-calendars"
          aria-selected={tab === "calendars"}
          aria-controls="panel-calendars"
          tabIndex={tab === "calendars" ? 0 : -1}
          className={`${tabBtn} ${
            tab === "calendars"
              ? "border-accent text-ink-900 dark:text-ink-100"
              : "border-transparent text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200"
          }`}
          onClick={() => select("calendars")}
        >
          Calendars
        </button>
        <button
          type="button"
          role="tab"
          id="tab-ical-feeds"
          aria-selected={tab === "feeds"}
          aria-controls="panel-ical-feeds"
          tabIndex={tab === "feeds" ? 0 : -1}
          className={`${tabBtn} ${
            tab === "feeds"
              ? "border-accent text-ink-900 dark:text-ink-100"
              : "border-transparent text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200"
          }`}
          onClick={() => select("feeds")}
        >
          iCal feeds
        </button>
      </div>

      <div
        role="tabpanel"
        id="panel-calendars"
        aria-labelledby="tab-calendars"
        hidden={tab !== "calendars"}
        className="flex flex-col gap-4"
      >
        {props.calendarsPanel}
      </div>
      <div
        role="tabpanel"
        id="panel-ical-feeds"
        aria-labelledby="tab-ical-feeds"
        hidden={tab !== "feeds"}
        className="flex flex-col gap-2"
      >
        {props.feedsPanel}
      </div>
    </div>
  );
}
