/**
 * Inngest: one ordered pass that refetches Google Calendar busy, clears
 * weather / sleep-routine / travel-leg caches, then rebuilds the ICS snapshot.
 */

import { clearScheduleAuxiliaryCaches } from "@/lib/clear-schedule-auxiliary-caches";
import { refreshGoogleBusyCacheForUser } from "@/lib/google-busy-cache";
import { runRegenerateForUser } from "@/lib/regenerate-user-snapshot";
import { inngest } from "./client";

export const fullScheduleRefresh = inngest.createFunction(
  { id: "full-schedule-refresh", retries: 2, concurrency: { limit: 1, key: "event.data.userId" } },
  { event: "user/schedule.full-refresh-requested" },
  async ({ event, step }) => {
    const { userId } = event.data;

    await step.run("google-calendar-busy", () => refreshGoogleBusyCacheForUser(userId));
    await step.run("weather-sleep-travel-caches", () => clearScheduleAuxiliaryCaches(userId));
    const { eventCount } = await step.run("regenerate-snapshot", () => runRegenerateForUser(userId));

    await step.sendEvent("notify-completion", {
      name: "user/snapshot.completed",
      data: { userId }
    });

    return { eventCount };
  }
);
