import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { posts } from "@margot/schema";
import { eq, and } from "drizzle-orm";
import { getAuthUser, unauthorized, notFound } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const [row] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, user.id)));

  if (!row) return notFound();
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const allowed = ["title", "body", "status", "channel", "scheduledAt"] as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = { updatedAt: new Date() };
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  const [row] = await db
    .update(posts)
    .set(updates)
    .where(and(eq(posts.id, id), eq(posts.userId, user.id)))
    .returning();

  if (!row) return notFound();
  return NextResponse.json(row);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const [row] = await db
    .delete(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, user.id)))
    .returning();

  if (!row) return notFound();
  return new NextResponse(null, { status: 204 });
}
