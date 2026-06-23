import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, signals } from "@margot/schema";
import { eq, and } from "drizzle-orm";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await db
    .delete(signals)
    .where(and(eq(signals.id, id), eq(signals.userId, session.user.id)));
  return NextResponse.json({ ok: true });
}
