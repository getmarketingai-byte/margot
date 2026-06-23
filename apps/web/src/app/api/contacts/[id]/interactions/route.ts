import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, contacts, contactInteractions, type NewContactInteraction } from "@margot/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: contactId } = await params;

  // Verify contact belongs to user
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.userId, session.user.id)))
    .limit(1);
  if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db
    .select()
    .from(contactInteractions)
    .where(and(eq(contactInteractions.contactId, contactId), eq(contactInteractions.userId, session.user.id)))
    .orderBy(desc(contactInteractions.date));

  return NextResponse.json(rows);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: contactId } = await params;

  // Verify contact belongs to user
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.userId, session.user.id)))
    .limit(1);
  if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { type, body: interactionBody, date } = body;

  const insert: NewContactInteraction = {
    userId: session.user.id,
    contactId,
    type: typeof type === "string" ? type : "email",
    body: typeof interactionBody === "string" ? interactionBody : "",
    date: date ? new Date(date as string) : new Date(),
  };

  const [row] = await db.insert(contactInteractions).values(insert).returning();
  return NextResponse.json(row, { status: 201 });
}
