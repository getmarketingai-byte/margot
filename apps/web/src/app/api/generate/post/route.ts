import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, userProfiles, signals, concepts } from "@margot/schema";
import { eq, and, desc } from "drizzle-orm";
import { generateLinkedInPost, type SignalContext, type ConceptContext } from "@margot/marketing-engine";

export const runtime = "nodejs";
export const maxDuration = 30;

// In-memory rate limiter: 3 generations per user per minute
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const recent = (rateLimitMap.get(userId) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  if (recent.length >= RATE_LIMIT_MAX) return false;
  recent.push(now);
  rateLimitMap.set(userId, recent);
  return true;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!checkRateLimit(session.user.id)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait a moment before regenerating." },
      { status: 429 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "AI generation not configured. Please add ANTHROPIC_API_KEY to your Vercel project environment variables.",
      },
      { status: 503 }
    );
  }

  const userId = session.user.id;

  // Parse optional context params from query string
  const url = new URL(req.url);
  const signalId = url.searchParams.get("signalId");
  const conceptId = url.searchParams.get("conceptId");

  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  let signalCtx: SignalContext | undefined;
  let conceptCtx: ConceptContext | undefined;

  if (signalId) {
    const [row] = await db
      .select()
      .from(signals)
      .where(and(eq(signals.id, signalId), eq(signals.userId, userId)))
      .limit(1);
    if (row) {
      signalCtx = { id: row.id, headline: row.headline, summary: row.summary, source: row.source };
    }
  } else if (conceptId) {
    const [row] = await db
      .select()
      .from(concepts)
      .where(and(eq(concepts.id, conceptId), eq(concepts.userId, userId)))
      .limit(1);
    if (row) {
      conceptCtx = { id: row.id, title: row.title, body: row.body, tags: row.tags };
    }
  } else {
    // Auto-context: pick from 3 most recent signals (preferred) or concepts
    const [recentSignals, recentConcepts] = await Promise.all([
      db.select().from(signals).where(eq(signals.userId, userId)).orderBy(desc(signals.capturedAt)).limit(3),
      db.select().from(concepts).where(eq(concepts.userId, userId)).orderBy(desc(concepts.updatedAt)).limit(3),
    ]);

    if (recentSignals.length > 0) {
      const pick = recentSignals[Math.floor(Math.random() * recentSignals.length)];
      signalCtx = { id: pick.id, headline: pick.headline, summary: pick.summary, source: pick.source };
    } else if (recentConcepts.length > 0) {
      const pick = recentConcepts[Math.floor(Math.random() * recentConcepts.length)];
      conceptCtx = { id: pick.id, title: pick.title, body: pick.body, tags: pick.tags };
    }
  }

  const generated = await generateLinkedInPost(profile ?? null, apiKey, signalCtx, conceptCtx);
  return NextResponse.json(generated);
}
