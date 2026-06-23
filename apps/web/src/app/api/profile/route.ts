import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, userProfiles, type NewUserProfile, type ContentPillar, type SignalSource } from "@margot/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [row] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, session.user.id))
    .limit(1);

  if (!row) {
    return NextResponse.json(null);
  }

  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest) {
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

  const {
    headline, bio, industry, website, linkedinUrl, twitterHandle,
    brandVoice, contentPillars, targetAudience, postingCadence,
    signalSources, salesModel, onboardingComplete,
  } = body;

  // Check if profile exists
  const [existing] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, session.user.id))
    .limit(1);

  const updates = {
    // Sprint 1 fields
    headline: typeof headline === "string" ? headline : undefined,
    bio: typeof bio === "string" ? bio : undefined,
    industry: typeof industry === "string" ? industry : undefined,
    website: typeof website === "string" ? website : undefined,
    linkedinUrl: typeof linkedinUrl === "string" ? linkedinUrl : undefined,
    twitterHandle: typeof twitterHandle === "string" ? twitterHandle : undefined,
    // Sprint 3 fields
    brandVoice: typeof brandVoice === "string" ? brandVoice : undefined,
    contentPillars: Array.isArray(contentPillars) ? (contentPillars as ContentPillar[]) : undefined,
    targetAudience: typeof targetAudience === "string" ? targetAudience : undefined,
    postingCadence: (["daily", "3x_week", "weekly", "custom"].includes(postingCadence as string))
      ? (postingCadence as "daily" | "3x_week" | "weekly" | "custom")
      : undefined,
    signalSources: Array.isArray(signalSources) ? (signalSources as SignalSource[]) : undefined,
    salesModel: (["subscription", "deal_pipeline"].includes(salesModel as string))
      ? (salesModel as "subscription" | "deal_pipeline")
      : undefined,
    onboardingComplete: onboardingComplete === true || onboardingComplete === "true" ? "true" as const : undefined,
    updatedAt: new Date(),
  };

  let row;
  if (existing) {
    const [updated] = await db
      .update(userProfiles)
      .set(updates)
      .where(eq(userProfiles.userId, session.user.id))
      .returning();
    row = updated;
  } else {
    const insert: NewUserProfile = {
      userId: session.user.id,
      ...updates,
    };
    const [created] = await db.insert(userProfiles).values(insert).returning();
    row = created;
  }

  const status = existing ? 200 : 201;
  const res = NextResponse.json(row, { status });

  // Set onboarding cookie so middleware can skip the DB check on every request
  if (updates.onboardingComplete === "true") {
    res.cookies.set("margot_onboarded", "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });
  }

  return res;
}
