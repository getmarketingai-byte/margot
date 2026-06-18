import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { posts } from "@margot/schema";
import { and, eq, desc } from "drizzle-orm";
import { getAuthUser, unauthorized } from "@/lib/api";

// Brain dumps are stored as posts with channel='brain-dump'
const BRAIN_DUMP_CHANNEL = "brain-dump";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const rows = await db
    .select()
    .from(posts)
    .where(and(eq(posts.userId, user.id), eq(posts.channel, BRAIN_DUMP_CHANNEL)))
    .orderBy(desc(posts.createdAt))
    .limit(50);

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  if (!body?.body && !body?.title) {
    return NextResponse.json({ error: "title or body is required" }, { status: 400 });
  }

  const title = (body.title as string) ?? (body.body as string).slice(0, 80);

  const [row] = await db
    .insert(posts)
    .values({
      userId: user.id,
      title,
      body: (body.body as string) ?? null,
      status: "draft",
      channel: BRAIN_DUMP_CHANNEL,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
