-- Idempotent schema sync for Calendar Automations (Postgres/Neon).
-- Safe to run multiple times.

BEGIN;

CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text,
  "email" text,
  "emailVerified" timestamp,
  "image" text,
  "stripeCustomerId" text,
  "subscriptionStatus" text DEFAULT 'none',
  "subscriptionId" text,
  "subscriptionPriceId" text,
  "subscriptionPeriodEnd" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "emailVerified" timestamp;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "image" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "stripeCustomerId" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "subscriptionStatus" text DEFAULT 'none';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "subscriptionId" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "subscriptionPriceId" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "subscriptionPeriodEnd" timestamp;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now();
ALTER TABLE "user" ALTER COLUMN "createdAt" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "user_email_unique" ON "user" ("email");

CREATE TABLE IF NOT EXISTS "account" (
  "userId" text NOT NULL,
  "type" text NOT NULL,
  "provider" text NOT NULL,
  "providerAccountId" text NOT NULL,
  "refresh_token" text,
  "access_token" text,
  "expires_at" integer,
  "token_type" text,
  "scope" text,
  "id_token" text,
  "session_state" text,
  CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider", "providerAccountId")
);

ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "userId" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "type" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "provider" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "providerAccountId" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "refresh_token" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "access_token" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "expires_at" integer;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "token_type" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "scope" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "id_token" text;
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "session_state" text;

ALTER TABLE "account" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "account" ALTER COLUMN "type" SET NOT NULL;
ALTER TABLE "account" ALTER COLUMN "provider" SET NOT NULL;
ALTER TABLE "account" ALTER COLUMN "providerAccountId" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "session" (
  "sessionToken" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "expires" timestamp NOT NULL
);

ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "sessionToken" text;
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "userId" text;
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "expires" timestamp;
ALTER TABLE "session" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "session" ALTER COLUMN "expires" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "verificationToken" (
  "identifier" text NOT NULL,
  "token" text NOT NULL,
  "expires" timestamp NOT NULL,
  CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier", "token")
);

ALTER TABLE "verificationToken" ADD COLUMN IF NOT EXISTS "identifier" text;
ALTER TABLE "verificationToken" ADD COLUMN IF NOT EXISTS "token" text;
ALTER TABLE "verificationToken" ADD COLUMN IF NOT EXISTS "expires" timestamp;
ALTER TABLE "verificationToken" ALTER COLUMN "identifier" SET NOT NULL;
ALTER TABLE "verificationToken" ALTER COLUMN "token" SET NOT NULL;
ALTER TABLE "verificationToken" ALTER COLUMN "expires" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "user_settings" (
  "userId" text PRIMARY KEY NOT NULL,
  "schemaVersion" integer DEFAULT 1 NOT NULL,
  "data" jsonb NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "userId" text;
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "schemaVersion" integer DEFAULT 1;
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "data" jsonb;
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now();
ALTER TABLE "user_settings" ALTER COLUMN "schemaVersion" SET NOT NULL;
ALTER TABLE "user_settings" ALTER COLUMN "data" SET NOT NULL;
ALTER TABLE "user_settings" ALTER COLUMN "updatedAt" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "weekly_plan" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "weekStart" text NOT NULL,
  "timezone" text NOT NULL,
  "data" jsonb NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "weekly_plan" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "weekly_plan" ADD COLUMN IF NOT EXISTS "userId" text;
ALTER TABLE "weekly_plan" ADD COLUMN IF NOT EXISTS "weekStart" text;
ALTER TABLE "weekly_plan" ADD COLUMN IF NOT EXISTS "timezone" text;
ALTER TABLE "weekly_plan" ADD COLUMN IF NOT EXISTS "data" jsonb;
ALTER TABLE "weekly_plan" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now();
ALTER TABLE "weekly_plan" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "weekly_plan" ALTER COLUMN "weekStart" SET NOT NULL;
ALTER TABLE "weekly_plan" ALTER COLUMN "timezone" SET NOT NULL;
ALTER TABLE "weekly_plan" ALTER COLUMN "data" SET NOT NULL;
ALTER TABLE "weekly_plan" ALTER COLUMN "updatedAt" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "weekly_plan_user_week" ON "weekly_plan" ("userId", "weekStart");

CREATE TABLE IF NOT EXISTS "calendar_snapshot" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "generatedAt" timestamp DEFAULT now() NOT NULL,
  "windowStartMs" text NOT NULL,
  "windowEndMs" text NOT NULL,
  "events" jsonb NOT NULL
);

ALTER TABLE "calendar_snapshot" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "calendar_snapshot" ADD COLUMN IF NOT EXISTS "userId" text;
ALTER TABLE "calendar_snapshot" ADD COLUMN IF NOT EXISTS "generatedAt" timestamp DEFAULT now();
ALTER TABLE "calendar_snapshot" ADD COLUMN IF NOT EXISTS "windowStartMs" text;
ALTER TABLE "calendar_snapshot" ADD COLUMN IF NOT EXISTS "windowEndMs" text;
ALTER TABLE "calendar_snapshot" ADD COLUMN IF NOT EXISTS "events" jsonb;
ALTER TABLE "calendar_snapshot" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "calendar_snapshot" ALTER COLUMN "generatedAt" SET NOT NULL;
ALTER TABLE "calendar_snapshot" ALTER COLUMN "windowStartMs" SET NOT NULL;
ALTER TABLE "calendar_snapshot" ALTER COLUMN "windowEndMs" SET NOT NULL;
ALTER TABLE "calendar_snapshot" ALTER COLUMN "events" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "feed_token" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "token" text NOT NULL,
  "feed" text NOT NULL,
  "name" text NOT NULL,
  "revoked" boolean DEFAULT false NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "feed_token" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "feed_token" ADD COLUMN IF NOT EXISTS "userId" text;
ALTER TABLE "feed_token" ADD COLUMN IF NOT EXISTS "token" text;
ALTER TABLE "feed_token" ADD COLUMN IF NOT EXISTS "feed" text;
ALTER TABLE "feed_token" ADD COLUMN IF NOT EXISTS "name" text;
ALTER TABLE "feed_token" ADD COLUMN IF NOT EXISTS "revoked" boolean DEFAULT false;
ALTER TABLE "feed_token" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now();
ALTER TABLE "feed_token" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "feed_token" ALTER COLUMN "token" SET NOT NULL;
ALTER TABLE "feed_token" ALTER COLUMN "feed" SET NOT NULL;
ALTER TABLE "feed_token" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "feed_token" ALTER COLUMN "revoked" SET NOT NULL;
ALTER TABLE "feed_token" ALTER COLUMN "createdAt" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "feed_token_token_unique" ON "feed_token" ("token");
CREATE UNIQUE INDEX IF NOT EXISTS "feed_token_user_feed" ON "feed_token" ("userId", "feed");

CREATE TABLE IF NOT EXISTS "job_lock" (
  "key" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "acquiredAt" timestamp DEFAULT now() NOT NULL,
  "expiresAt" timestamp NOT NULL
);

ALTER TABLE "job_lock" ADD COLUMN IF NOT EXISTS "key" text;
ALTER TABLE "job_lock" ADD COLUMN IF NOT EXISTS "userId" text;
ALTER TABLE "job_lock" ADD COLUMN IF NOT EXISTS "acquiredAt" timestamp DEFAULT now();
ALTER TABLE "job_lock" ADD COLUMN IF NOT EXISTS "expiresAt" timestamp;
ALTER TABLE "job_lock" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "job_lock" ALTER COLUMN "acquiredAt" SET NOT NULL;
ALTER TABLE "job_lock" ALTER COLUMN "expiresAt" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_userId_user_id_fk'
  ) THEN
    ALTER TABLE "account"
      ADD CONSTRAINT "account_userId_user_id_fk"
      FOREIGN KEY ("userId") REFERENCES "public"."user"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'session_userId_user_id_fk'
  ) THEN
    ALTER TABLE "session"
      ADD CONSTRAINT "session_userId_user_id_fk"
      FOREIGN KEY ("userId") REFERENCES "public"."user"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_userId_user_id_fk'
  ) THEN
    ALTER TABLE "user_settings"
      ADD CONSTRAINT "user_settings_userId_user_id_fk"
      FOREIGN KEY ("userId") REFERENCES "public"."user"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'weekly_plan_userId_user_id_fk'
  ) THEN
    ALTER TABLE "weekly_plan"
      ADD CONSTRAINT "weekly_plan_userId_user_id_fk"
      FOREIGN KEY ("userId") REFERENCES "public"."user"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calendar_snapshot_userId_user_id_fk'
  ) THEN
    ALTER TABLE "calendar_snapshot"
      ADD CONSTRAINT "calendar_snapshot_userId_user_id_fk"
      FOREIGN KEY ("userId") REFERENCES "public"."user"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feed_token_userId_user_id_fk'
  ) THEN
    ALTER TABLE "feed_token"
      ADD CONSTRAINT "feed_token_userId_user_id_fk"
      FOREIGN KEY ("userId") REFERENCES "public"."user"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END$$;

COMMIT;
