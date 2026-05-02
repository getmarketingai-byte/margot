/**
 * Single Vercel Cron entry for Hobby (daily-only schedules). Authenticates with
 * CRON_SECRET, then fans out regenerate and Google busy refresh for every user
 * via Inngest — same work as the former split routes, one invocation per day.
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
  const events = users.flatMap((u) => [
    {
      name: "user/regenerate.requested" as const,
      data: { userId: u.id, reason: "cron" as const }
    },
    {
      name: "user/google-busy.refresh-requested" as const,
      data: { userId: u.id, reason: "cron" as const }
    }
  ]);
  if (events.length > 0) await inngest.send(events);
  return NextResponse.json({
    enqueuedEvents: events.length,
    users: users.length
  });
}
