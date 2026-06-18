import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, userProfiles, type NewUserProfile } from "@margot/schema";
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

  const { headline, bio, industry, targetAudience, website, linkedinUrl, twitterHandle } = body;

  // Check if profile exists
  const [existing] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, session.user.id))
    .limit(1);

  const updates = {
    headline: typeof headline === "string" ? headline : undefined,
    bio: typeof bio === "string" ? bio : undefined,
    industry: typeof industry === "string" ? industry : undefined,
    targetAudience: typeof targetAudience === "string" ? targetAudience : undefined,
    website: typeof website === "string" ? website : undefined,
    linkedinUrl: typeof linkedinUrl === "string" ? linkedinUrl : undefined,
    twitterHandle: typeof twitterHandle === "string" ? twitterHandle : undefined,
    updatedAt: new Date(),
  };

  if (existing) {
    const [updated] = await db
      .update(userProfiles)
      .set(updates)
      .where(eq(userProfiles.userId, session.user.id))
      .returning();

    return NextResponse.json(updated);
  } else {
    const insert: NewUserProfile = {
      userId: session.user.id,
      ...updates,
    };

    const [created] = await db.insert(userProfiles).values(insert).returning();
    return NextResponse.json(created, { status: 201 });
  }
}
