import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { posts } from "@margot/schema";
import { eq, desc, gte, and } from "drizzle-orm";
import { getAuthUser, unauthorized } from "@/lib/api";

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status");
  const channel = searchParams.get("channel");

  const conditions = [eq(posts.userId, user.id)];
  if (status) conditions.push(eq(posts.status, status));
  if (channel) conditions.push(eq(posts.channel, channel));

  const rows = await db
    .select()
    .from(posts)
    .where(and(...conditions))
    .orderBy(desc(posts.createdAt))
    .limit(50);

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  if (!body?.title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const [row] = await db
    .insert(posts)
    .values({
      userId: user.id,
      title: body.title as string,
      body: (body.body as string) ?? null,
      status: (body.status as string) ?? "draft",
      channel: (body.channel as string) ?? null,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt as string) : null,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
