import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { contacts } from "@margot/schema";
import { eq, desc } from "drizzle-orm";
import { getAuthUser, unauthorized } from "@/lib/api";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const rows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, user.id))
    .orderBy(desc(contacts.createdAt))
    .limit(100);

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  if (!body?.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const [row] = await db
    .insert(contacts)
    .values({
      userId: user.id,
      name: body.name as string,
      email: (body.email as string) ?? null,
      company: (body.company as string) ?? null,
      role: (body.role as string) ?? null,
      notes: (body.notes as string) ?? null,
      status: (body.status as string) ?? "lead",
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
