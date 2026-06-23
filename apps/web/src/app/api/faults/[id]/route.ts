import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, faultReports } from "@margot/schema";
import { eq } from "drizzle-orm";

/**
 * PATCH /api/faults/[id]
 * Update fault status and/or notes. Requires authentication.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { status, notes } = body;

  const updates: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (typeof status === "string") {
    updates.status = status;
    if (status === "resolved") {
      updates.resolvedAt = new Date();
    }
  }
  if (typeof notes === "string") {
    updates.notes = notes;
  }

  const [row] = await db
    .update(faultReports)
    .set(updates)
    .where(eq(faultReports.id, id))
    .returning();

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(row);
}

/**
 * DELETE /api/faults/[id]
 * Delete a fault report. Requires authentication.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  await db.delete(faultReports).where(eq(faultReports.id, id));
  return new NextResponse(null, { status: 204 });
}
