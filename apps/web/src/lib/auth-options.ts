/**
 * Auth.js v5 configuration with:
 * - Google OAuth provider
 * - AES-256-GCM token encryption before DB storage
 * - Drizzle ORM adapter (Neon Postgres)
 * - Session callback that returns decrypted user data
 */

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { NextAuthConfig } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { db } from "@margot/schema";
import { accounts, users } from "@margot/schema/schema";
import { encrypt, decrypt, encryptOptional } from "@/lib/encrypt";
import { eq } from "drizzle-orm";

export const authOptions: NextAuthConfig = {
  // Required in production on Vercel (or any reverse-proxy) so Auth.js trusts
  // x-forwarded-host / x-forwarded-proto and builds correct callback URLs.
  trustHost: true,

  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
  }),

  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          // Request offline access so we get a refresh_token
          access_type: "offline",
          prompt: "consent",
          scope: [
            "openid",
            "email",
            "profile",
            // Add Google-specific scopes here as needed:
            // "https://www.googleapis.com/auth/gmail.readonly",
          ].join(" "),
        },
      },
    }),
  ],

  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60, // refresh every 24h
  },

  callbacks: {
    /**
     * Called after a successful OAuth sign-in.
     * Encrypts access_token and refresh_token before they are persisted
     * by the Drizzle adapter.
     */
    async signIn({ account }) {
      if (!account) return true;

      // Encrypt tokens in-place before the adapter writes them to DB
      if (account.access_token) {
        account.access_token = encrypt(account.access_token);
      }
      if (account.refresh_token) {
        account.refresh_token = encrypt(account.refresh_token);
      }

      return true;
    },

    /**
     * Session callback – enrich the session with user data.
     * Tokens are NOT exposed to the client; they remain server-side.
     */
    async session({ session, user }) {
      if (session.user && user) {
        session.user.id = user.id;
      }
      return session;
    },
  },

  events: {
    /**
     * Fires when an account is linked (new OAuth connection).
     * Useful for analytics/audit logging.
     */
    async linkAccount({ user, account }) {
      console.info("[auth] account linked", {
        userId: user.id,
        provider: account.provider,
      });
    },
  },

  pages: {
    signIn: "/",
    // No custom error page — use Auth.js built-in so the error endpoint
    // doesn't 500 when it tries to re-validate a broken provider config.
  },

  debug: process.env.NODE_ENV === "development",
};

/**
 * Retrieves the decrypted access_token for a given user.
 * Call this from server-side code (Server Components, API routes, Server Actions).
 * Never expose the raw token to the browser.
 */
export async function getDecryptedAccessToken(userId: string): Promise<string | null> {
  const rows = await db
    .select({ accessToken: accounts.access_token })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .limit(1);

  const row = rows[0];
  if (!row?.accessToken) return null;

  try {
    return decrypt(row.accessToken);
  } catch {
    console.error("[auth] failed to decrypt access_token for user", userId);
    return null;
  }
}

/**
 * Retrieves the decrypted refresh_token for a given user.
 */
export async function getDecryptedRefreshToken(userId: string): Promise<string | null> {
  const rows = await db
    .select({ refreshToken: accounts.refresh_token })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .limit(1);

  const row = rows[0];
  if (!row?.refreshToken) return null;

  try {
    return decrypt(row.refreshToken);
  } catch {
    console.error("[auth] failed to decrypt refresh_token for user", userId);
    return null;
  }
}
