/**
 * Vercel Cron entrypoint — fans out regenerate events for every user. Uses the
 * shared CRON_SECRET so only Vercel's cron infrastructure can trigger it.
 *
 * Schedule is configured in vercel.json (daily on Hobby; feeds also refresh on client fetch).
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
    name: "user/regenerate.requested" as const,
    data: { userId: u.id, reason: "cron" as const }
  }));
  if (events.length > 0) await inngest.send(events);
  return NextResponse.json({ enqueued: events.length });
}
