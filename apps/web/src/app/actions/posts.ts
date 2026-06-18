"use server";

import { auth } from "@/auth";
import { db, posts } from "@margot/schema";
import { eq, and, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { PostStatus, PostPlatform } from "@margot/schema";

async function requireUser(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

export async function getPosts(status?: PostStatus) {
  const userId = await requireUser();
  const conditions = [eq(posts.userId, userId)];
  if (status) conditions.push(eq(posts.status, status));
  return db
    .select()
    .from(posts)
    .where(and(...conditions))
    .orderBy(desc(posts.updatedAt));
}

export async function getPost(id: string) {
  const userId = await requireUser();
  const rows = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createPost(data: {
  content: string;
  platform: PostPlatform;
  status?: PostStatus;
}) {
  const userId = await requireUser();
  const rows = await db
    .insert(posts)
    .values({
      userId,
      content: data.content,
      platform: data.platform,
      status: data.status ?? "draft",
    })
    .returning();
  revalidatePath("/dashboard/posts");
  return rows[0];
}

export async function updatePost(
  id: string,
  data: Partial<{
    content: string;
    platform: PostPlatform;
    status: PostStatus;
    scheduledAt: Date | null;
  }>
) {
  const userId = await requireUser();
  const rows = await db
    .update(posts)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(posts.id, id), eq(posts.userId, userId)))
    .returning();
  revalidatePath("/dashboard/posts");
  revalidatePath(`/dashboard/posts/${id}`);
  return rows[0] ?? null;
}

export async function deletePost(id: string) {
  const userId = await requireUser();
  await db.delete(posts).where(and(eq(posts.id, id), eq(posts.userId, userId)));
  revalidatePath("/dashboard/posts");
}
