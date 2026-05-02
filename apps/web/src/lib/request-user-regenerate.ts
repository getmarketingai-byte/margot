import "server-only";

import { inngest } from "@/lib/inngest";

/**
 * Queue a user's calendar snapshot rebuild (ICS + stored snapshot).
 * Uses the same Inngest event as daily cron and POST /api/regenerate.
 */
export async function requestUserRegenerate(
  userId: string,
  reason: "user" | "settings-change" = "user"
): Promise<void> {
  await inngest.send({
    name: "user/regenerate.requested",
    data: { userId, reason }
  });
}
