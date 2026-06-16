import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

const REQUIRED_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
].join(" ");

/**
 * Edge-safe Auth.js config — no Node.js-only imports (no DB, no crypto).
 * Used by middleware to verify session cookies without touching the database.
 * The full server-side config (with DrizzleAdapter) lives in lib/auth.ts.
 */
export const authConfig = {
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          scope: REQUIRED_SCOPES,
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
} satisfies NextAuthConfig;
