/**
 * Vercel Cron — enqueue a Google busy refresh for every user (Inngest handles
 * concurrency). Keeps Postgres busy snapshots warm between dashboard visits.
 */

import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { inngest } from "@/lib/inngest";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  if (!db) return NextResponse.json({ skipped: true });

  const users = await db.select({ id: schema.users.id }).from(schema.users);
  const events = users.map((u) => ({
    name: "user/google-busy.refresh-requested" as const,
    data: { userId: u.id, reason: "cron" as const }
  }));
  if (events.length > 0) await inngest.send(events);
  return NextResponse.json({ enqueued: events.length });
}
