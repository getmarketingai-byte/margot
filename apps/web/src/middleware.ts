import { auth } from "@/auth";
import { NextResponse } from "next/server";

/**
 * Auth.js v5 middleware.
 * Protects /dashboard/* and /api/* (except auth endpoints).
 * Unauthenticated requests are redirected to the landing page.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;

  const isAuthenticated = !!req.auth?.user;

  // Protect all dashboard routes
  if (pathname.startsWith("/dashboard")) {
    if (!isAuthenticated) {
      const signInUrl = new URL("/", req.url);
      signInUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(signInUrl);
    }
  }

  // Protect onboarding route
  if (pathname.startsWith("/onboarding")) {
    if (!isAuthenticated) {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  // Protect all API routes except auth routes
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/auth")) {
    if (!isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, manifest.json, service-worker.js (PWA)
     * - Public assets
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|service-worker.js|icons/).*)",
  ],
};
