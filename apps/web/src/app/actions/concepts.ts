"use server";

import { auth } from "@/auth";
import { db, concepts, brainDumps, posts, userProfiles } from "@margot/schema";
import { eq, and, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { generateLinkedInPost } from "@margot/marketing-engine";

async function requireUser(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

export async function getConcepts() {
  const userId = await requireUser();
  return db
    .select()
    .from(concepts)
    .where(eq(concepts.userId, userId))
    .orderBy(desc(concepts.updatedAt));
}

export async function createBrainDump(content: string) {
  const userId = await requireUser();

  // Save brain dump
  const [dump] = await db
    .insert(brainDumps)
    .values({ userId, content, tags: [] })
    .returning();

  // Auto-create concept from brain dump
  const lines = content.trim().split("\n");
  const title = (lines[0] ?? "").slice(0, 120) || "Brain dump";
  const bodyText = lines.slice(1).join("\n").trim();

  const [concept] = await db
    .insert(concepts)
    .values({ userId, title, body: bodyText, tags: [], status: "idea" })
    .returning();

  revalidatePath("/dashboard/concepts");
  return { dump, concept };
}

export async function createConcept(data: {
  title: string;
  body?: string;
  parentId?: string;
  tags?: string[];
}) {
  const userId = await requireUser();
  const [row] = await db
    .insert(concepts)
    .values({
      userId,
      title: data.title,
      body: data.body ?? "",
      tags: data.tags ?? [],
      parentId: data.parentId,
      status: "idea",
    })
    .returning();
  revalidatePath("/dashboard/concepts");
  return row;
}

export async function updateConcept(
  id: string,
  data: Partial<{ title: string; body: string; status: string; tags: string[] }>
) {
  const userId = await requireUser();
  const [row] = await db
    .update(concepts)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(concepts.id, id), eq(concepts.userId, userId)))
    .returning();
  revalidatePath("/dashboard/concepts");
  return row;
}

export async function deleteConcept(id: string) {
  const userId = await requireUser();
  await db
    .delete(concepts)
    .where(and(eq(concepts.id, id), eq(concepts.userId, userId)));
  revalidatePath("/dashboard/concepts");
}

export async function conceptToPost(conceptId: string) {
  const userId = await requireUser();
  const [concept] = await db
    .select()
    .from(concepts)
    .where(and(eq(concepts.id, conceptId), eq(concepts.userId, userId)))
    .limit(1);
  if (!concept) throw new Error("Concept not found");

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
      undefined,
      { id: concept.id, title: concept.title, body: concept.body, tags: concept.tags }
    );
    content = generated.content;
  } else {
    // Fallback when AI not configured: stub with concept data
    content = concept.body
      ? `${concept.title}\n\n${concept.body}`
      : concept.title;
  }

  const [post] = await db
    .insert(posts)
    .values({ userId, content, platform: "linkedin", status: "draft" })
    .returning();

  revalidatePath("/dashboard/posts");
  if (!post) throw new Error("Failed to create post");
  redirect(`/dashboard/posts/${post.id}`);
}
