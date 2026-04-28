/**
 * Auth.js (NextAuth v5) configuration.
 *
 * Uses the Drizzle adapter and Google as the only provider for now. We request
 * read-only Calendar scopes plus profile/email — write scopes are NOT requested
 * because the app's primary output is iCal feeds, and "least privilege" wins
 * Google OAuth verification. The refresh token is captured into the `accounts`
 * table so background jobs can refresh access tokens between cron runs.
 */

import NextAuth from "next-auth";
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
