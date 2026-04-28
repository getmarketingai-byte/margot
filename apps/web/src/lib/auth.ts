/**
 * Auth.js (NextAuth v5) configuration.
 *
 * Uses the Drizzle adapter and Google as the only provider for now. We request
 * read-only Calendar scopes plus profile/email — write scopes are NOT requested
 * because the app's primary output is iCal feeds, and "least privilege" wins
 * Google OAuth verification. The refresh token is captured into the `accounts`
 * table so background jobs can refresh access tokens between cron runs.
 */

import NextAuth, { type Session } from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db, schema } from "./db/index";
import { TRIAL_LENGTH_MS } from "./subscription";

const authUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
if (process.env.NODE_ENV === "production" && (!authUrl || authUrl.includes("localhost"))) {
  console.warn(
    "[auth] AUTH_URL/NEXTAUTH_URL is missing or points to localhost in production; PKCE callbacks may fail."
  );
}

/* ───────────────────────── Preview-only auth bypass ──────────────────────────
 * Vercel Preview deployments can opt-in to auto-login as a configured user so
 * iterating on the dashboard doesn't require a full Google OAuth round-trip.
 *
 * Hard production safeguard: the bypass only activates when `VERCEL_ENV` is
 * exactly "preview". `NODE_ENV` is intentionally NOT used because Vercel
 * Preview builds run with `NODE_ENV=production`. The opt-in flag must also
 * be present, so a stray env var alone is insufficient.
 */
const PREVIEW_AUTH_USER_EMAIL = (process.env.PREVIEW_AUTH_USER_EMAIL ?? "").trim();
const PREVIEW_AUTH_OPT_IN = process.env.PREVIEW_AUTH_ENABLED === "true";
const VERCEL_ENV = process.env.VERCEL_ENV;

export function isPreviewAuthBypassEnabled(): boolean {
  return (
    VERCEL_ENV === "preview" &&
    PREVIEW_AUTH_OPT_IN &&
    PREVIEW_AUTH_USER_EMAIL.length > 0
  );
}

if (PREVIEW_AUTH_OPT_IN && VERCEL_ENV !== "preview") {
  // Loud warning — never silently activate, never activate in production.
  console.warn(
    `[auth] PREVIEW_AUTH_ENABLED is set but VERCEL_ENV="${VERCEL_ENV ?? "unset"}" (not "preview"); bypass is inert.`
  );
}

const REQUIRED_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
].join(" ");

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: db
    ? DrizzleAdapter(db, {
        usersTable: schema.users,
        accountsTable: schema.accounts,
        sessionsTable: schema.sessions,
        verificationTokensTable: schema.verificationTokens
      })
    : undefined,
  session: { strategy: "database" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          scope: REQUIRED_SCOPES,
          access_type: "offline",
          prompt: "consent"
        }
      }
    })
  ],
  callbacks: {
    session({ session, user }) {
      if (session.user && user) {
        session.user.id = user.id;
      }
      return session;
    }
  },
  events: {
    // Seed the 7-day no-card trial when a user row is first created. Stripe
    // subscription columns remain null until/unless they upgrade via Checkout.
    async createUser({ user }) {
      if (!db || !user.id) return;
      try {
        await db
          .update(schema.users)
          .set({ trialEndsAt: new Date(Date.now() + TRIAL_LENGTH_MS) })
          .where(eq(schema.users.id, user.id));
      } catch (err) {
        console.error("[auth] failed to seed trialEndsAt", { userId: user.id, err });
      }
    }
  }
});

/**
 * Look up the configured preview user by email and return a synthesized
 * session shape compatible with `auth()`. Returns `null` if the bypass isn't
 * active or the user can't be resolved.
 */
async function buildPreviewSession(): Promise<Session | null> {
  if (!isPreviewAuthBypassEnabled() || !db) return null;
  try {
    const rows = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        image: schema.users.image
      })
      .from(schema.users)
      .where(eq(schema.users.email, PREVIEW_AUTH_USER_EMAIL))
      .limit(1);
    const row = rows[0];
    if (!row) {
      console.warn(
        `[auth] preview bypass: user "${PREVIEW_AUTH_USER_EMAIL}" not found; falling through to real auth.`
      );
      return null;
    }
    return {
      user: {
        id: row.id,
        name: row.name ?? null,
        email: row.email ?? PREVIEW_AUTH_USER_EMAIL,
        image: row.image ?? null
      },
      // Match Auth.js's iso-string `expires`. One day is plenty for preview.
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    } satisfies Session;
  } catch (err) {
    console.error("[auth] preview bypass: failed to resolve user", err);
    return null;
  }
}

/**
 * Drop-in replacement for `auth()` that, in Vercel Preview only and when
 * explicitly opted-in via env, returns a synthesized session for the configured
 * user. In all other environments this is exactly `auth()`.
 *
 * Use this anywhere a server page/action/route gates on `session.user.id`.
 */
export async function authOrPreview(): Promise<Session | null> {
  const session = await auth();
  if (session?.user?.id) return session;
  if (!isPreviewAuthBypassEnabled()) return session;
  return buildPreviewSession();
}
