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
import { db, schema } from "./db/index";

const REQUIRED_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
].join(" ");

export const { handlers, auth, signIn, signOut } = NextAuth({
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
  }
});
