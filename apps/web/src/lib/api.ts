import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function getAuthUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return session.user as { id: string; name?: string | null; email?: string | null; image?: string | null };
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function badRequest(message = "Bad request") {
  return NextResponse.json({ error: message }, { status: 400 });
}
