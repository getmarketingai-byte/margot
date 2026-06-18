import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@margot/schema";
import { eq } from "drizzle-orm";
import { getAuthUser, unauthorized } from "@/lib/api";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email, image: users.image, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, user.id));

  return NextResponse.json(row ?? null);
}

export async function PATCH(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => ({}));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = {};
  if ("name" in body) updates.name = body.name;
  if ("image" in body) updates.image = body.image;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
  }

  const [row] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, user.id))
    .returning({ id: users.id, name: users.name, email: users.email, image: users.image });

  return NextResponse.json(row);
}
