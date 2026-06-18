import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, brainDumps, type NewBrainDump } from "@margot/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(brainDumps)
    .where(eq(brainDumps.userId, session.user.id))
    .orderBy(desc(brainDumps.createdAt));

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

  const { content, tags } = body;

  if (!content || typeof content !== "string") {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const insert: NewBrainDump = {
    userId: session.user.id,
    content,
    tags: Array.isArray(tags) ? (tags as string[]) : [],
  };

  const [row] = await db.insert(brainDumps).values(insert).returning();

  return NextResponse.json(row, { status: 201 });
}
