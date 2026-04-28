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
import { findFeedByToken, filterEventsForFeed } from "@/lib/feeds";
import { loadLatestSnapshot } from "@/lib/snapshots";
import { hasActiveSubscription } from "@/lib/subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const subscribed = hasActiveSubscription(user?.subscriptionStatus ?? "none");

  const snapshot = await loadLatestSnapshot(feed.userId);
  const events = snapshot ? filterEventsForFeed(snapshot.events, feed.feed) : [];

  // When subscription lapses, return a single explanatory event rather than 404
  // so users see a clear in-calendar message inside their existing app.
  const finalEvents = subscribed
    ? events
    : [
        {
          uid: `subscription-required-${feed.userId}`,
          kind: "weekly-review" as const,
          title: "Subscription required to refresh schedule",
          description:
            "Your Calendar Automations subscription is inactive. Visit the dashboard to resume.",
          startMs: Date.now(),
          endMs: Date.now() + 30 * 60 * 1000,
          busy: false,
          tags: []
        }
      ];

  const ics = renderIcs(finalEvents, {
    calendarName: `Calendar Automations · ${feed.feed}`,
    domain: "calendar-automations",
    refreshIntervalMinutes: 30
  });
  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=60",
      "Last-Modified": new Date(snapshot?.generatedAt ?? Date.now()).toUTCString()
    }
  });
}
