"use server";

import { authOrPreview } from "@/lib/auth";
import { generateFeedToken } from "@/lib/feed-token";
import { ensureCustomFeedToken, ensureAllFeedToken } from "@/lib/feeds";
import { db, schema } from "@/lib/db";
import {
  parseIcsFeedRules,
  icsFeedRulesHasSelection,
  type IcsFeedRulesInclude
} from "@margot/schema";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const MAX_CUSTOM_ICS_FEEDS = 20;

function includeFromFormData(formData: FormData): IcsFeedRulesInclude {
  const tick = (field: string) => formData.get(field) === "on";
  const ids = [...new Set(formData.getAll("goalIds").map(String).filter(Boolean))];
  const gids = [...new Set(formData.getAll("groupIds").map(String).filter(Boolean))];
  const out: IcsFeedRulesInclude = {
    allGoalsAndSegments: tick("allGoalsAndSegments"),
    sleep: tick("sleep"),
    routine: tick("routine"),
    genericTravel: tick("genericTravel"),
    gymGoals: tick("gymGoals"),
    gymPads: tick("gymPads"),
    weatherTimemap: tick("weatherTimemap"),
    invertedTimemap: tick("invertedTimemap"),
    weeklyReview: tick("weeklyReview"),
    monthlyStrategy: tick("monthlyStrategy"),
    errand: tick("errand")
  };
  if (ids.length) out.goalIds = ids;
  if (gids.length) out.groupIds = gids;
  return out;
}

function rulesFromFormData(formData: FormData): { ok: false; message: string } | { ok: true; rules: { version: 1; include: IcsFeedRulesInclude } } {
  const include = includeFromFormData(formData);
  if (!icsFeedRulesHasSelection(include)) {
    return { ok: false, message: "Choose at least one category, goal, or group for this feed." };
  }
  const rules = { version: 1 as const, include };
  try {
    parseIcsFeedRules(rules);
  } catch {
    return { ok: false, message: "Invalid rule configuration." };
  }
  return { ok: true, rules };
}

export async function createCustomIcsFeed(formData: FormData): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id || !db) return;
  const userId = session.user.id;

  const title = String(formData.get("title") ?? "").trim().slice(0, 120);
  if (!title) return;

  const existingFeeds = await db
    .select({ id: schema.icsCustomFeeds.id })
    .from(schema.icsCustomFeeds)
    .where(eq(schema.icsCustomFeeds.userId, userId))
    .limit(MAX_CUSTOM_ICS_FEEDS + 1);
  if (existingFeeds.length >= MAX_CUSTOM_ICS_FEEDS) return;

  const parsed = rulesFromFormData(formData);
  if (!parsed.ok) return;

  const id = crypto.randomUUID();
  await db.insert(schema.icsCustomFeeds).values({
    id,
    userId,
    title,
    rules: parsed.rules,
    updatedAt: new Date()
  });
  await ensureCustomFeedToken(userId, id, title, generateFeedToken);
  revalidatePath("/dashboard/calendars");
  revalidatePath("/dashboard/feeds");
}

export async function updateCustomIcsFeed(formData: FormData): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id || !db) return;
  const userId = session.user.id;
  const id = String(formData.get("feedId") ?? "").trim();
  if (!id) return;

  const title = String(formData.get("title") ?? "").trim().slice(0, 120);
  if (!title) return;

  const parsed = rulesFromFormData(formData);
  if (!parsed.ok) return;

  await db
    .update(schema.icsCustomFeeds)
    .set({ title, rules: parsed.rules, updatedAt: new Date() })
    .where(and(eq(schema.icsCustomFeeds.id, id), eq(schema.icsCustomFeeds.userId, userId)));
  await ensureCustomFeedToken(userId, id, title, generateFeedToken);
  revalidatePath("/dashboard/calendars");
  revalidatePath("/dashboard/feeds");
}

export async function deleteCustomIcsFeed(formData: FormData): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id || !db) return;
  const userId = session.user.id;
  const id = String(formData.get("feedId") ?? "").trim();
  if (!id) return;
  await db
    .delete(schema.icsCustomFeeds)
    .where(and(eq(schema.icsCustomFeeds.id, id), eq(schema.icsCustomFeeds.userId, userId)));
  revalidatePath("/dashboard/calendars");
  revalidatePath("/dashboard/feeds");
}

export async function rotateEverythingIcsFeed(): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id || !db) return;
  await ensureAllFeedToken(session.user.id, "Everything", generateFeedToken);
  revalidatePath("/dashboard/calendars");
  revalidatePath("/dashboard/feeds");
}

export async function rotateCustomIcsFeed(formData: FormData): Promise<void> {
  const session = await authOrPreview();
  if (!session?.user?.id || !db) return;
  const userId = session.user.id;
  const id = String(formData.get("feedId") ?? "").trim();
  const title = String(formData.get("feedTitle") ?? "Custom feed").trim().slice(0, 120) || "Custom feed";
  if (!id) return;
  const owner = await db
    .select({ id: schema.icsCustomFeeds.id })
    .from(schema.icsCustomFeeds)
    .where(and(eq(schema.icsCustomFeeds.id, id), eq(schema.icsCustomFeeds.userId, userId)))
    .limit(1);
  if (!owner[0]) return;
  await ensureCustomFeedToken(userId, id, title, generateFeedToken);
  revalidatePath("/dashboard/calendars");
  revalidatePath("/dashboard/feeds");
}
