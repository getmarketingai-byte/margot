/**
 * Public ICS feed endpoint. Returns the latest snapshot filtered to the feed kind
 * associated with `:token`. Tokens are unguessable per `feed-token.ts` and tied
 * to one user. Path is `/api/feeds/<token>.ics`; the trailing `.ics` is stripped
 * before lookup so calendar apps can detect the format.
 */

import { NextRequest, NextResponse } from "next/server";
import { renderIcs } from "@calendar-automations/planner";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { findFeedByToken, filterEventsForFeed, normalizeEventTitlesForIcs } from "@/lib/feeds";
import {
  FEED_TRIGGERED_REGENERATE_MIN_INTERVAL_MS,
  runRegenerateForUser
} from "@/lib/regenerate-user-snapshot";
import { loadLatestSnapshot } from "@/lib/snapshots";
import { getBillingState } from "@/lib/subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Length of the gated placeholder event. Long enough to stand out in a day view. */
const GATE_EVENT_DURATION_MS = 4 * 60 * 60 * 1000;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token: rawToken } = await params;
  const token = rawToken.replace(/\.ics$/i, "");
  const feed = await findFeedByToken(token);
  if (!feed || feed.revoked) {
    return new NextResponse("Not found", { status: 404 });
  }
  const userRows = db
    ? await db.select().from(schema.users).where(eq(schema.users.id, feed.userId)).limit(1)
    : [];
  const user = userRows[0];
  const billing = getBillingState({
    subscriptionStatus: user?.subscriptionStatus ?? "none",
    trialEndsAt: user?.trialEndsAt ?? null,
    paymentGateBypass: user?.paymentGateBypass ?? false
  });
  const allowed = billing.allowed;

  let snapshot = await loadLatestSnapshot(feed.userId);
  if (allowed && db) {
    const stale =
      !snapshot ||
      Date.now() - snapshot.generatedAt >= FEED_TRIGGERED_REGENERATE_MIN_INTERVAL_MS;
    if (stale) {
      try {
        await runRegenerateForUser(feed.userId);
        snapshot = await loadLatestSnapshot(feed.userId);
      } catch (err) {
        console.error("feed-triggered regenerate failed", { userId: feed.userId, err });
      }
    }
  }

  const events = snapshot ? filterEventsForFeed(snapshot.events, feed.feed) : [];

  // When access is denied, return a single 4-hour explanatory event rather than
  // 404 so users see an unmissable in-calendar message inside their existing
  // app and can find their way back to the dashboard to resolve it.
  const gateStartMs = Date.now();
  const finalEvents = allowed
    ? events
    : [
        {
          uid: `subscription-required-${feed.userId}`,
          kind: "weekly-review" as const,
          title: "Subscription required to refresh schedule",
          description:
            "Your Calendar Automations subscription is inactive. Visit the dashboard to resume.",
          startMs: gateStartMs,
          endMs: gateStartMs + GATE_EVENT_DURATION_MS,
          busy: false,
          tags: []
        }
      ];

  const icsEvents = normalizeEventTitlesForIcs(finalEvents);
  const ics = renderIcs(icsEvents, {
    calendarName: `Calendar Automations · ${feed.feed}`,
    domain: "calendar-automations",
    refreshIntervalMinutes: 30
  });
  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=0, must-revalidate",
      "Last-Modified": new Date(snapshot?.generatedAt ?? Date.now()).toUTCString()
    }
  });
}
