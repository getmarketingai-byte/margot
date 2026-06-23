import { auth } from "@/auth";
import { NextResponse } from "next/server";

/**
 * Auth.js v5 middleware.
 * Protects /dashboard/* and /api/* (except auth endpoints).
 * Unauthenticated requests are redirected to the landing page.
 * Onboarding redirect (no profile) is handled in the dashboard layout
 * after session is confirmed, using the /api/profile endpoint.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthenticated = !!req.auth?.user;

  // Protect all API routes (except /api/auth)
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/auth")) {
    if (!isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Protect /dashboard routes
  if (pathname.startsWith("/dashboard")) {
    if (!isAuthenticated) {
      const signInUrl = new URL("/", req.url);
      signInUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(signInUrl);
    }
  }

  // Protect /onboarding — must be authenticated
  if (pathname.startsWith("/onboarding") && !isAuthenticated) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|service-worker.js|icons/).*)",
  ],
};
