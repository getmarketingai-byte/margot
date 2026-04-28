/**
 * Helpers for the per-user ICS feed surface — token lookup, filter by feed kind.
 */

import { and, eq } from "drizzle-orm";
import type { GeneratedEvent } from "@calendar-automations/schema";
import { db, schema } from "./db/index";

export type FeedKind = "timemap" | "sleep" | "travel" | "weekly" | "all";

export async function findFeedByToken(
  token: string
): Promise<{ userId: string; feed: FeedKind; revoked: boolean } | null> {
  if (!db) return null;
  const rows = await db
    .select()
    .from(schema.feedTokens)
    .where(eq(schema.feedTokens.token, token))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { userId: row.userId, feed: row.feed, revoked: row.revoked };
}

export async function ensureFeedToken(
  userId: string,
  feed: FeedKind,
  name: string,
  generator: () => string
): Promise<string> {
  if (!db) return "dev-token";
  const existing = await db
    .select()
    .from(schema.feedTokens)
    .where(and(eq(schema.feedTokens.userId, userId), eq(schema.feedTokens.feed, feed)))
    .limit(1);
  const row = existing[0];
  if (row && !row.revoked) return row.token;
  const token = generator();
  if (row) {
    await db
      .update(schema.feedTokens)
      .set({ token, revoked: false })
      .where(eq(schema.feedTokens.id, row.id));
  } else {
    await db.insert(schema.feedTokens).values({ userId, feed, name, token });
  }
  return token;
}

export function filterEventsForFeed(
  events: readonly GeneratedEvent[],
  feed: FeedKind
): GeneratedEvent[] {
  if (feed === "all") return [...events];
  return events.filter((e) => {
    switch (feed) {
      case "timemap":
        return e.kind === "timemap" || e.kind === "routine";
      case "sleep":
        return e.kind === "sleep";
      case "travel":
        return e.kind === "travel";
      case "weekly":
        return (
          e.kind === "weekly-goal" ||
          e.kind === "weekly-review" ||
          e.kind === "monthly-strategy" ||
          e.kind === "consistency-segment"
        );
      default:
        return false;
    }
  });
}

function ensureBracketedTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed;
  return `[${trimmed}]`;
}

/**
 * All feed events should render in ICS with bracketed titles so downstream
 * calendar tooling can match a single consistent naming convention.
 */
export function normalizeEventTitlesForIcs(events: readonly GeneratedEvent[]): GeneratedEvent[] {
  return events.map((event) => {
    return { ...event, title: ensureBracketedTitle(event.title) };
  });
}
