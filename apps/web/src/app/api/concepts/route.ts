import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, concepts, type NewConcept } from "@margot/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(concepts)
    .where(eq(concepts.userId, session.user.id))
    .orderBy(desc(concepts.createdAt));

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

  const { title, body: bodyText, tags, parentId } = body;

  if (!title || typeof title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const insert: NewConcept = {
    userId: session.user.id,
    title,
    body: typeof bodyText === "string" ? bodyText : "",
    tags: Array.isArray(tags) ? (tags as string[]) : [],
    parentId: typeof parentId === "string" ? parentId : undefined,
  };

  const [row] = await db.insert(concepts).values(insert).returning();

  return NextResponse.json(row, { status: 201 });
}
