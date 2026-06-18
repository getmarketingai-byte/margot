import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, posts, type PostPlatform, type PostStatus } from "@margot/schema";
import { eq, and } from "drizzle-orm";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const [row] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, session.user.id)))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership first
  const [existing] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, session.user.id)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Partial<{
    content: string;
    platform: PostPlatform;
    status: PostStatus;
    scheduledAt: Date | null;
    metadata: Record<string, unknown>;
    updatedAt: Date;
  }> = { updatedAt: new Date() };

  if (body.content !== undefined) updates.content = body.content as string;
  if (body.platform !== undefined) updates.platform = body.platform as PostPlatform;
  if (body.status !== undefined) updates.status = body.status as PostStatus;
  if (body.scheduledAt !== undefined) {
    updates.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt as string) : null;
  }
  if (body.metadata !== undefined) updates.metadata = body.metadata as Record<string, unknown>;

  const [updated] = await db
    .update(posts)
    .set(updates)
    .where(and(eq(posts.id, id), eq(posts.userId, session.user.id)))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [deleted] = await db
    .delete(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, session.user.id)))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
