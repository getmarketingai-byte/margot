/**
 * Manual regenerate endpoint — the dashboard kicks this off after settings changes.
 * Authenticated users only; emits an Inngest event and returns immediately.
 */

import { NextResponse } from "next/server";
import { authOrPreview } from "@/lib/auth";
import { requestUserRegenerate } from "@/lib/request-user-regenerate";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  const session = await authOrPreview();
  if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });
  await requestUserRegenerate(session.user.id);
  return NextResponse.json({ queued: true });
}
