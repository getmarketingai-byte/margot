/**
 * Helpers for the per-user ICS feed surface — token lookup, builtin `all`,
 * custom feed rules, and ICS title normalization.
 */

import type { GeneratedEvent } from "@margot/schema";
import {
  parseIcsFeedRules,
  type IcsFeedRules
} from "@margot/schema";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "./db/index";

export type BuiltinFeedKind = "all";

export type ResolvedFeed =
  | { mode: "all"; userId: string }
  | {
      mode: "custom";
      userId: string;
      customFeedId: string;
      title: string;
      rules: IcsFeedRules;
    };

export async function findFeedByToken(token: string): Promise<ResolvedFeed | null> {
  if (!db) return null;
  const rows = await db
    .select({
      userId: schema.feedTokens.userId,
      revoked: schema.feedTokens.revoked,
      feed: schema.feedTokens.feed,
      customFeedId: schema.feedTokens.customFeedId,
      customTitle: schema.icsCustomFeeds.title,
      customRules: schema.icsCustomFeeds.rules
    })
    .from(schema.feedTokens)
    .leftJoin(
      schema.icsCustomFeeds,
      eq(schema.feedTokens.customFeedId, schema.icsCustomFeeds.id)
    )
    .where(eq(schema.feedTokens.token, token))
    .limit(1);
  const row = rows[0];
  if (!row || row.revoked) return null;

  const { userId, feed } = row;

  if (feed === "all") {
    return { mode: "all", userId };
  }

  const customFeedId = row.customFeedId;
  if (!customFeedId || row.customRules == null) return null;

  try {
    const rules = parseIcsFeedRules(row.customRules);
    return {
      mode: "custom",
      userId,
      customFeedId,
      title: row.customTitle ?? "Custom feed",
      rules
    };
  } catch {
    return null;
  }
}

export async function ensureAllFeedToken(
  userId: string,
  name: string,
  generator: () => string
): Promise<string> {
  if (!db) return "dev-token";
  const existing = await db
    .select()
    .from(schema.feedTokens)
    .where(
      and(eq(schema.feedTokens.userId, userId), eq(schema.feedTokens.feed, "all"), isNull(schema.feedTokens.customFeedId))
    )
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
    await db.insert(schema.feedTokens).values({
      userId,
      feed: "all",
      customFeedId: null,
      name,
      token
    });
  }
  return token;
}

export async function ensureCustomFeedToken(
  userId: string,
  customFeedId: string,
  name: string,
  generator: () => string
): Promise<string> {
  if (!db) return "dev-token";
  const existing = await db
    .select()
    .from(schema.feedTokens)
    .where(and(eq(schema.feedTokens.userId, userId), eq(schema.feedTokens.customFeedId, customFeedId)))
    .limit(1);
  const row = existing[0];
  if (row && !row.revoked) return row.token;
  const token = generator();
  if (row) {
    await db
      .update(schema.feedTokens)
      .set({ token, revoked: false, name })
      .where(eq(schema.feedTokens.id, row.id));
  } else {
    await db.insert(schema.feedTokens).values({
      userId,
      feed: "custom",
      customFeedId,
      name,
      token
    });
  }
  return token;
}

export function filterEventsForFeed(
  events: readonly GeneratedEvent[],
  feed: BuiltinFeedKind
): GeneratedEvent[] {
  if (feed !== "all") return [];
  return events.filter((e) => !snapshotEventIsHiddenTravelArrivalBuffer(e));
}

/** Stale snapshots may still list these; they are never published to ICS. */
function snapshotEventIsHiddenTravelArrivalBuffer(e: GeneratedEvent): boolean {
  return e.tags?.includes("drive-arrival-buffer") === true;
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
