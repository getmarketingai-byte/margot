import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PATHS = ["/dashboard"];

// Auth.js v5 database-session cookie names (prod and dev)
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

/**
 * Edge-safe middleware — checks for a session cookie without touching the DB.
 * Actual session validity is enforced server-side in each protected page/layout.
 *
 * Using NextAuth(authConfig) here would always return unauthenticated because
 * authConfig has no DrizzleAdapter, so it expects JWTs, but auth.ts issues
 * database session tokens (random strings). A cookie-existence check avoids
 * that mismatch while staying Edge Runtime compatible.
 */
export function middleware(request: NextRequest): NextResponse {
  const { nextUrl, cookies } = request;

  // Preview-only auto-login: page guards synthesise the session, let all through.
  const previewAuthActive =
    process.env.VERCEL_ENV === "preview" &&
    process.env.PREVIEW_AUTH_ENABLED === "true" &&
    (process.env.PREVIEW_AUTH_USER_EMAIL ?? "").trim().length > 0;

  if (previewAuthActive) return NextResponse.next();

  const isProtected = PROTECTED_PATHS.some((p) =>
    nextUrl.pathname.startsWith(p)
  );

  if (isProtected) {
    const hasSession = SESSION_COOKIES.some((name) => cookies.has(name));
    if (!hasSession) {
      const signInUrl = new URL("/sign-in", nextUrl.origin);
      signInUrl.searchParams.set("callbackUrl", nextUrl.pathname);
      return NextResponse.redirect(signInUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
