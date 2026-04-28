import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";

const PROTECTED = ["/dashboard"];

export default auth((req) => {
  const { nextUrl } = req as NextRequest & { auth?: { user?: { id?: string } } };
  const session = (req as unknown as { auth?: { user?: { id?: string } } }).auth;
  const isProtected = PROTECTED.some((p) => nextUrl.pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();
  if (!session?.user?.id) {
    const url = nextUrl.clone();
    url.pathname = "/api/auth/signin";
    return NextResponse.redirect(url);
  }
  // Subscription gating is enforced at the data layer (feed routes) so the
  // dashboard is always reachable for billing recovery.
  return NextResponse.next();
});

export const config = {
  matcher: ["/dashboard/:path*"]
};
