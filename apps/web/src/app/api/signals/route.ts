import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { signals } from "@margot/schema";
import { eq, desc } from "drizzle-orm";
import { getAuthUser, unauthorized } from "@/lib/api";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const rows = await db
    .select()
    .from(signals)
    .where(eq(signals.userId, user.id))
    .orderBy(desc(signals.createdAt))
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
    .insert(signals)
    .values({
      userId: user.id,
      title: body.title as string,
      content: (body.content as string) ?? null,
      url: (body.url as string) ?? null,
      source: (body.source as string) ?? "manual",
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
