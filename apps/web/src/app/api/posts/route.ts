import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, posts, type NewPost, type PostPlatform, type PostStatus } from "@margot/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(posts)
    .where(eq(posts.userId, session.user.id))
    .orderBy(desc(posts.createdAt));

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { content, platform, status, scheduledAt, metadata } = body;

  if (!content || typeof content !== "string") {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  if (!platform || typeof platform !== "string") {
    return NextResponse.json({ error: "platform is required" }, { status: 400 });
  }

  const insert: NewPost = {
    userId: session.user.id,
    content,
    platform: platform as PostPlatform,
    status: ((status as string | undefined) ?? "draft") as PostStatus,
    scheduledAt: scheduledAt ? new Date(scheduledAt as string) : null,
    metadata: (metadata as Record<string, unknown> | undefined) ?? null,
  };

  const [row] = await db.insert(posts).values(insert).returning();

  return NextResponse.json(row, { status: 201 });
}
