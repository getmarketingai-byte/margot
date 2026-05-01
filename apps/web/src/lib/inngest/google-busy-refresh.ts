/**
 * Inngest worker: refresh persisted Google busy intervals for one user.
 * Triggered by Vercel cron fan-out (same auth pattern as regenerate cron).
 */

import { refreshGoogleBusyCacheForUser } from "@/lib/google-busy-cache";
import { inngest } from "./client";

export const refreshGoogleBusySnapshot = inngest.createFunction(
  {
    id: "refresh-google-busy-cache",
    retries: 2,
    concurrency: { limit: 1, key: "event.data.userId" }
  },
  { event: "user/google-busy.refresh-requested" },
  async ({ event, step }) => {
    const { userId } = event.data;
    await step.run("sync-google-busy", () => refreshGoogleBusyCacheForUser(userId));
    return { ok: true as const };
  }
);
