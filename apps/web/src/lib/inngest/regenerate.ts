/**
 * Inngest function: regenerate a user's CalendarSnapshot.
 *
 * Delegates to {@link runRegenerateForUser} so the same pipeline runs for cron,
 * dashboard-triggered jobs, and feed-driven refresh (see api/feeds route).
 */

import { inngest } from "./client";
import { runRegenerateForUser } from "../regenerate-user-snapshot";

export const regenerateSnapshot = inngest.createFunction(
  { id: "regenerate-snapshot", retries: 2, concurrency: { limit: 1, key: "event.data.userId" } },
  { event: "user/regenerate.requested" },
  async ({ event, step }) => {
    const { userId } = event.data;

    const { eventCount } = await step.run("regenerate", () => runRegenerateForUser(userId));

    await step.sendEvent("notify-completion", {
      name: "user/snapshot.completed",
      data: { userId }
    });

    return { eventCount };
  }
);
