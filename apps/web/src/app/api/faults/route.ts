import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, faultReports } from "@margot/schema";
import { desc, eq } from "drizzle-orm";

/**
 * POST /api/faults
 * Report a fault. Can be called from server or client.
 * Authentication is optional — unauthenticated errors are still recorded.
 */
export async function POST(req: NextRequest) {
  const session = await auth();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { type, statusCode, path, message, stack, metadata } = body;

  if (!path || typeof path !== "string") {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }
  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const [row] = await db.insert(faultReports).values({
    userId: session?.user?.id ?? null,
    type: typeof type === "string" ? type : "unknown",
    statusCode: typeof statusCode === "number" ? statusCode : null,
    path,
    message,
    stack: typeof stack === "string" ? stack : null,
    userAgent: req.headers.get("user-agent"),
    metadata: metadata ?? null,
    status: "open",
  }).returning();

  return NextResponse.json(row, { status: 201 });
}

/**
 * GET /api/faults
 * List fault reports. Requires authentication.
 * Supports ?status=open|investigating|resolved|wont_fix filter.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status");

  if (statusFilter) {
    const rows = await db
      .select()
      .from(faultReports)
      .where(eq(faultReports.status, statusFilter))
      .orderBy(desc(faultReports.createdAt));
    return NextResponse.json(rows);
  }

  const rows = await db
    .select()
    .from(faultReports)
    .orderBy(desc(faultReports.createdAt));

  return NextResponse.json(rows);
}
