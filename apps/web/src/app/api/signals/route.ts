import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, signals, type NewSignal } from "@margot/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: signals.id,
      userId: signals.userId,
      source: signals.source,
      headline: signals.headline,
      url: signals.url,
      summary: signals.summary,
      capturedAt: signals.capturedAt,
      createdAt: signals.createdAt,
      // Omit embedding to keep response size small
    })
    .from(signals)
    .where(eq(signals.userId, session.user.id))
    .orderBy(desc(signals.capturedAt));

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

  const { source, headline, url, summary } = body;

  if (!source || typeof source !== "string") {
    return NextResponse.json({ error: "source is required" }, { status: 400 });
  }
  if (!headline || typeof headline !== "string") {
    return NextResponse.json({ error: "headline is required" }, { status: 400 });
  }

  const insert: NewSignal = {
    userId: session.user.id,
    source,
    headline,
    url: typeof url === "string" ? url : null,
    summary: typeof summary === "string" ? summary : null,
  };

  const [row] = await db.insert(signals).values(insert).returning();

  // Don't return embedding in response
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { embedding: _embedding, ...rest } = row!;
  return NextResponse.json(rest, { status: 201 });
}
