import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Edge-safe NextAuth instance — uses providers-only config with no Node.js imports.
// The full DrizzleAdapter-backed auth lives in lib/auth.ts for server use only.
const { auth } = NextAuth(authConfig);

const PROTECTED_PATHS = ["/dashboard"];

// Preview-only auto-login: when active, page-level guards use `authOrPreview()`
// to synthesize the session, so middleware just lets requests through.
const PREVIEW_AUTH_ACTIVE =
  process.env.VERCEL_ENV === "preview" &&
  process.env.PREVIEW_AUTH_ENABLED === "true" &&
  (process.env.PREVIEW_AUTH_USER_EMAIL ?? "").trim().length > 0;

const middleware = PREVIEW_AUTH_ACTIVE
  ? function previewMiddleware(): NextResponse {
      return NextResponse.next();
    }
  : auth((req) => {
      const { nextUrl } = req;
      const isAuthenticated = !!req.auth?.user?.id;
      const isProtected = PROTECTED_PATHS.some((p) =>
        nextUrl.pathname.startsWith(p)
      );

      if (isProtected && !isAuthenticated) {
        const signInUrl = new URL("/sign-in", nextUrl.origin);
        signInUrl.searchParams.set("callbackUrl", nextUrl.pathname);
        return NextResponse.redirect(signInUrl);
      }

      return NextResponse.next();
    });

export default middleware;

export const config = {
  matcher: ["/dashboard/:path*"],
};
