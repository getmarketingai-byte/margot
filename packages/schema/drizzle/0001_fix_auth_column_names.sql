-- Fix auth table column names to match Drizzle/Auth.js snake_case conventions.
-- The original schema was bootstrapped from CalendarAutomations which used camelCase
-- columns. DrizzleAdapter and Auth.js expect snake_case column names.

-- user table
ALTER TABLE "user" RENAME COLUMN "emailVerified" TO "email_verified";
ALTER TABLE "user" RENAME COLUMN "createdAt" TO "created_at";

-- account table
ALTER TABLE "account" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "account" RENAME COLUMN "providerAccountId" TO "provider_account_id";

-- session table
ALTER TABLE "session" RENAME COLUMN "sessionToken" TO "session_token";
ALTER TABLE "session" RENAME COLUMN "userId" TO "user_id";
