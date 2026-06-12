import NextAuth, { type Session } from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { accounts, sessions, users, verificationTokens } from "@margot/schema";

const authUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
if (
  process.env.NODE_ENV === "production" &&
  (!authUrl || authUrl.includes("localhost"))
) {
  console.warn(
    "[auth] AUTH_URL/NEXTAUTH_URL is missing or points to localhost in production; OAuth callbacks may fail."
  );
}

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
  console.warn(
    `[auth] PREVIEW_AUTH_ENABLED is set but VERCEL_ENV="${VERCEL_ENV ?? "unset"}" (not "preview"); bypass is inert.`
  );
}

const secret =
  process.env.AUTH_SECRET ??
  (process.env.NODE_ENV === "development"
    ? "dev-only-auth-secret-set-AUTH_SECRET-in-env-local"
    : undefined);

if (!process.env.AUTH_SECRET && process.env.NODE_ENV === "development") {
  console.warn(
    "[auth] AUTH_SECRET is unset; using a dev-only fallback. Copy apps/web/.env.example to .env.local and set AUTH_SECRET."
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  pages: {
    signIn: "/sign-in",
  },
  session: {
    strategy: "database",
  },
  callbacks: {
    session({ session, user }) {
      if (session.user && user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
});

async function buildPreviewSession(): Promise<Session | null> {
  if (!isPreviewAuthBypassEnabled()) return null;
  try {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
      })
      .from(users)
      .where(eq(users.email, PREVIEW_AUTH_USER_EMAIL))
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
        image: row.image ?? null,
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    } satisfies Session;
  } catch (err) {
    console.error("[auth] preview bypass: failed to resolve user", err);
    return null;
  }
}

/**
 * Drop-in replacement for `auth()` that, on Vercel Preview only and when
 * explicitly opted-in, returns a synthesized session for the configured user.
 */
export async function authOrPreview(): Promise<Session | null> {
  const session = await auth();
  if (session?.user?.id) return session;
  if (!isPreviewAuthBypassEnabled()) return session;
  return buildPreviewSession();
}
