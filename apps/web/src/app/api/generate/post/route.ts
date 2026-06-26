import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, userProfiles } from "@margot/schema";
import { eq } from "drizzle-orm";
import { generateLinkedInPost } from "@margot/marketing-engine";

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

export async function POST() {
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

  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, session.user.id))
    .limit(1);

  const generated = await generateLinkedInPost(profile ?? null, apiKey);
  return NextResponse.json(generated);
}
