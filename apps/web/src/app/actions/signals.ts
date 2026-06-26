"use server";

import { auth } from "@/auth";
import { db, signals, posts, userProfiles } from "@margot/schema";
import { eq, and, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { generateLinkedInPost } from "@margot/marketing-engine";

async function requireUser(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

export async function getSignals(sourceType?: string) {
  const userId = await requireUser();
  const conditions = [eq(signals.userId, userId)];
  if (sourceType && sourceType !== "all") {
    conditions.push(eq(signals.source, sourceType));
  }
  return db
    .select()
    .from(signals)
    .where(and(...conditions))
    .orderBy(desc(signals.capturedAt));
}

export async function createSignal(data: {
  headline: string;
  url?: string;
  source: string;
  summary?: string;
}) {
  const userId = await requireUser();
  const [row] = await db
    .insert(signals)
    .values({
      userId,
      headline: data.headline,
      url: data.url,
      source: data.source,
      summary: data.summary,
    })
    .returning();
  revalidatePath("/dashboard/signals");
  return row;
}

export async function deleteSignal(id: string) {
  const userId = await requireUser();
  await db
    .delete(signals)
    .where(and(eq(signals.id, id), eq(signals.userId, userId)));
  revalidatePath("/dashboard/signals");
}

export async function signalToPost(signalId: string) {
  const userId = await requireUser();
  const [signal] = await db
    .select()
    .from(signals)
    .where(and(eq(signals.id, signalId), eq(signals.userId, userId)))
    .limit(1);
  if (!signal) throw new Error("Signal not found");

  const apiKey = process.env.ANTHROPIC_API_KEY;

  let content: string;
  if (apiKey) {
    const [profileRow] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    const generated = await generateLinkedInPost(
      profileRow ?? null,
      apiKey,
      { id: signal.id, headline: signal.headline, summary: signal.summary, source: signal.source }
    );
    content = generated.content;
  } else {
    // Fallback when AI not configured: stub with signal data
    const parts = [`📡 Signal: ${signal.headline}`];
    if (signal.summary) parts.push(`\n${signal.summary}`);
    if (signal.url) parts.push(`\nSource: ${signal.url}`);
    content = parts.join("");
  }

  const [post] = await db
    .insert(posts)
    .values({ userId, content, platform: "linkedin", status: "draft" })
    .returning();

  revalidatePath("/dashboard/posts");
  if (!post) throw new Error("Failed to create post");
  redirect(`/dashboard/posts/${post.id}`);
}
