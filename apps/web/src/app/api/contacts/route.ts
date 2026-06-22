import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, contacts, type NewContact } from "@margot/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, session.user.id))
    .orderBy(desc(contacts.createdAt));

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

  const { name, email, company, tags, notes, lastContactedAt } = body;

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const insert: NewContact = {
    userId: session.user.id,
    name,
    email: typeof email === "string" ? email : null,
    company: typeof company === "string" ? company : null,
    tags: Array.isArray(tags) ? (tags as string[]) : [],
    notes: typeof notes === "string" ? notes : null,
    lastContactedAt: lastContactedAt ? new Date(lastContactedAt as string) : null,
  };

  const [row] = await db.insert(contacts).values(insert).returning();

  return NextResponse.json(row, { status: 201 });
}
