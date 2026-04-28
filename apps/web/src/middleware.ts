import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";

const PROTECTED = ["/dashboard"];

// Preview-only auto-login: when active, the dashboard renders as the configured
// user without any session cookie. Page-level guards use `authOrPreview()` to
// synthesize the session, so the middleware just needs to let requests through.
// VERCEL_ENV must be exactly "preview" — Vercel never sets that in production,
// so this branch can never activate on the production deploy.
const PREVIEW_AUTH_ACTIVE =
  process.env.VERCEL_ENV === "preview" &&
  process.env.PREVIEW_AUTH_ENABLED === "true" &&
  (process.env.PREVIEW_AUTH_USER_EMAIL ?? "").trim().length > 0;

const middleware = PREVIEW_AUTH_ACTIVE
  ? function previewMiddleware(): NextResponse {
      return NextResponse.next();
    }
  : auth((req) => {
      const { nextUrl } = req as NextRequest & { auth?: { user?: { id?: string } } };
      const session = (req as unknown as { auth?: { user?: { id?: string } } }).auth;
      const isProtected = PROTECTED.some((p) => nextUrl.pathname.startsWith(p));
      if (!isProtected) return NextResponse.next();
      if (!session?.user?.id) {
        const url = nextUrl.clone();
        url.pathname = "/api/auth/signin";
        url.searchParams.set("callbackUrl", "/dashboard");
        return NextResponse.redirect(url);
      }
      // Subscription gating is enforced at the data layer (feed routes) so the
      // dashboard is always reachable for billing recovery.
      return NextResponse.next();
    });

export default middleware;

export const config = {
  matcher: ["/dashboard/:path*"]
};
