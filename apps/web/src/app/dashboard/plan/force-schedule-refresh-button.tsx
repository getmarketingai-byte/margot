"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestFullScheduleRefresh } from "./actions";

export function ForceScheduleRefreshButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    setMessage(null);
    setPending(true);
    try {
      await requestFullScheduleRefresh();
      setMessage(
        "Queued: calendar, weather, sleep, travel, and feed rebuild. Give it a few seconds, then refresh if the grid still looks stale."
      );
      router.refresh();
    } catch (err) {
      console.warn("requestFullScheduleRefresh failed", err);
      setMessage("Could not queue refresh. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <button
        type="button"
        disabled={pending}
        onClick={() => void handleClick()}
        className={`shrink-0 rounded border px-3 py-1.5 text-sm font-medium ${
          pending
            ? "cursor-not-allowed border-ink-200 opacity-50 dark:border-ink-600"
            : "border-ink-300 text-ink-700 hover:bg-ink-50 dark:border-ink-500 dark:text-ink-100 dark:hover:bg-ink-700/40"
        }`}
      >
        {pending ? "Queuing…" : "Refresh schedule data"}
      </button>
      {message ? (
        <p className="text-xs leading-snug text-ink-600 dark:text-ink-300 sm:max-w-md sm:text-right">
          {message}
        </p>
      ) : (
        <p className="text-xs text-ink-500 dark:text-ink-400 sm:max-w-md sm:text-right">
          Re-fetch Google Calendar, weather forecast, sleep blocks, and travel times, then rebuild
          your plan and iCal output.
        </p>
      )}
    </div>
  );
}
