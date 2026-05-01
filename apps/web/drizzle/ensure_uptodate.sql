-- Idempotent schema sync for Calendar Automations (Postgres/Neon).
-- Safe to run multiple times.
--
-- JSON document evolution (Planning Hub, framework registry, weekly intent, etc.)
-- lives inside jsonb columns (`user_settings.data`, `weekly_plan.data`, …).
-- Those blobs are upgraded at read time by `migrateSettings()` in
-- `packages/schema`. New keys such as `schedulerFrameworkInclusion`,
-- `frameworkSystem`, and placement flags do not require SQL migrations.
-- When you introduce breaking *structural* defaults, bump `SETTINGS_SCHEMA_VERSION`
-- in `packages/schema/src/settings.ts` — still no DDL unless you add new tables/columns here.

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
  "trialEndsAt" timestamp,
  "paymentGateBypass" boolean DEFAULT false NOT NULL,
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
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "trialEndsAt" timestamp;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "paymentGateBypass" boolean DEFAULT false;
ALTER TABLE "user" ALTER COLUMN "paymentGateBypass" SET DEFAULT false;
UPDATE "user" SET "paymentGateBypass" = false WHERE "paymentGateBypass" IS NULL;
ALTER TABLE "user" ALTER COLUMN "paymentGateBypass" SET NOT NULL;
-- Backfill: existing users without an explicit trial get 7 days from now so
-- they aren't immediately gated when this column is introduced.
UPDATE "user"
SET "trialEndsAt" = NOW() + INTERVAL '7 days'
WHERE "trialEndsAt" IS NULL
  AND ("subscriptionStatus" IS NULL OR "subscriptionStatus" = 'none');
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now();
ALTER TABLE "user" ALTER COLUMN "createdAt" SET NOT NULL;

-- Operator override: enable for a specific account by replacing the email.
--   UPDATE "user" SET "paymentGateBypass" = true WHERE "email" = 'you@example.com';

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

CREATE TABLE IF NOT EXISTS "daily_review" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "date" text NOT NULL,
  "timezone" text NOT NULL,
  "data" jsonb NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "daily_review" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "daily_review" ADD COLUMN IF NOT EXISTS "userId" text;
ALTER TABLE "daily_review" ADD COLUMN IF NOT EXISTS "date" text;
ALTER TABLE "daily_review" ADD COLUMN IF NOT EXISTS "timezone" text;
ALTER TABLE "daily_review" ADD COLUMN IF NOT EXISTS "data" jsonb;
ALTER TABLE "daily_review" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now();
ALTER TABLE "daily_review" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "daily_review" ALTER COLUMN "date" SET NOT NULL;
ALTER TABLE "daily_review" ALTER COLUMN "timezone" SET NOT NULL;
ALTER TABLE "daily_review" ALTER COLUMN "data" SET NOT NULL;
ALTER TABLE "daily_review" ALTER COLUMN "updatedAt" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "daily_review_user_date" ON "daily_review" ("userId", "date");

CREATE TABLE IF NOT EXISTS "weekly_review" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "weekStart" text NOT NULL,
  "timezone" text NOT NULL,
  "data" jsonb NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "weekly_review" ADD COLUMN IF NOT EXISTS "id" text;
ALTER TABLE "weekly_review" ADD COLUMN IF NOT EXISTS "userId" text;
ALTER TABLE "weekly_review" ADD COLUMN IF NOT EXISTS "weekStart" text;
ALTER TABLE "weekly_review" ADD COLUMN IF NOT EXISTS "timezone" text;
ALTER TABLE "weekly_review" ADD COLUMN IF NOT EXISTS "data" jsonb;
ALTER TABLE "weekly_review" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now();
ALTER TABLE "weekly_review" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "weekly_review" ALTER COLUMN "weekStart" SET NOT NULL;
ALTER TABLE "weekly_review" ALTER COLUMN "timezone" SET NOT NULL;
ALTER TABLE "weekly_review" ALTER COLUMN "data" SET NOT NULL;
ALTER TABLE "weekly_review" ALTER COLUMN "updatedAt" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "weekly_review_user_week" ON "weekly_review" ("userId", "weekStart");

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'daily_review_userId_user_id_fk'
  ) THEN
    ALTER TABLE "daily_review"
      ADD CONSTRAINT "daily_review_userId_user_id_fk"
      FOREIGN KEY ("userId") REFERENCES "public"."user"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'weekly_review_userId_user_id_fk'
  ) THEN
    ALTER TABLE "weekly_review"
      ADD CONSTRAINT "weekly_review_userId_user_id_fk"
      FOREIGN KEY ("userId") REFERENCES "public"."user"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "google_busy_cache" (
  "userId" text PRIMARY KEY NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  "windowStartMs" text NOT NULL,
  "windowEndMs" text NOT NULL,
  "sourcesFingerprint" text NOT NULL,
  "busyEvents" jsonb NOT NULL,
  "goalAvailabilityWindows" jsonb NOT NULL
);

ALTER TABLE "google_busy_cache" ADD COLUMN IF NOT EXISTS "userId" text;
ALTER TABLE "google_busy_cache" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now();
ALTER TABLE "google_busy_cache" ADD COLUMN IF NOT EXISTS "windowStartMs" text;
ALTER TABLE "google_busy_cache" ADD COLUMN IF NOT EXISTS "windowEndMs" text;
ALTER TABLE "google_busy_cache" ADD COLUMN IF NOT EXISTS "sourcesFingerprint" text;
ALTER TABLE "google_busy_cache" ADD COLUMN IF NOT EXISTS "busyEvents" jsonb;
ALTER TABLE "google_busy_cache" ADD COLUMN IF NOT EXISTS "goalAvailabilityWindows" jsonb;
ALTER TABLE "google_busy_cache" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "google_busy_cache" ALTER COLUMN "windowStartMs" SET NOT NULL;
ALTER TABLE "google_busy_cache" ALTER COLUMN "windowEndMs" SET NOT NULL;
ALTER TABLE "google_busy_cache" ALTER COLUMN "sourcesFingerprint" SET NOT NULL;
ALTER TABLE "google_busy_cache" ALTER COLUMN "busyEvents" SET NOT NULL;
ALTER TABLE "google_busy_cache" ALTER COLUMN "goalAvailabilityWindows" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'google_busy_cache_userId_user_id_fk'
  ) THEN
    ALTER TABLE "google_busy_cache"
      ADD CONSTRAINT "google_busy_cache_userId_user_id_fk"
      FOREIGN KEY ("userId") REFERENCES "public"."user"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "weather_forecast_cache" (
  "userId" text PRIMARY KEY NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  "coordsFingerprint" text NOT NULL,
  "openMeteoJson" jsonb,
  "openMeteoFetchedAtMs" text NOT NULL,
  "sunriseByDate" jsonb NOT NULL
);

ALTER TABLE "weather_forecast_cache" ADD COLUMN IF NOT EXISTS "userId" text;
ALTER TABLE "weather_forecast_cache" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now();
ALTER TABLE "weather_forecast_cache" ADD COLUMN IF NOT EXISTS "coordsFingerprint" text;
ALTER TABLE "weather_forecast_cache" ADD COLUMN IF NOT EXISTS "openMeteoJson" jsonb;
ALTER TABLE "weather_forecast_cache" ADD COLUMN IF NOT EXISTS "openMeteoFetchedAtMs" text;
ALTER TABLE "weather_forecast_cache" ADD COLUMN IF NOT EXISTS "sunriseByDate" jsonb;
ALTER TABLE "weather_forecast_cache" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "weather_forecast_cache" ALTER COLUMN "coordsFingerprint" SET NOT NULL;
ALTER TABLE "weather_forecast_cache" ALTER COLUMN "openMeteoFetchedAtMs" SET NOT NULL;
ALTER TABLE "weather_forecast_cache" ALTER COLUMN "sunriseByDate" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'weather_forecast_cache_userId_user_id_fk'
  ) THEN
    ALTER TABLE "weather_forecast_cache"
      ADD CONSTRAINT "weather_forecast_cache_userId_user_id_fk"
      FOREIGN KEY ("userId") REFERENCES "public"."user"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "system_sleep_routine_cache" (
  "userId" text NOT NULL,
  "weekStartIso" text NOT NULL,
  "inputsFingerprint" text NOT NULL,
  "sleepBlocks" jsonb NOT NULL,
  "routineBlocks" jsonb NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "system_sleep_routine_cache_userId_weekStartIso_pk" PRIMARY KEY ("userId", "weekStartIso")
);

ALTER TABLE "system_sleep_routine_cache" ADD COLUMN IF NOT EXISTS "userId" text;
ALTER TABLE "system_sleep_routine_cache" ADD COLUMN IF NOT EXISTS "weekStartIso" text;
ALTER TABLE "system_sleep_routine_cache" ADD COLUMN IF NOT EXISTS "inputsFingerprint" text;
ALTER TABLE "system_sleep_routine_cache" ADD COLUMN IF NOT EXISTS "sleepBlocks" jsonb;
ALTER TABLE "system_sleep_routine_cache" ADD COLUMN IF NOT EXISTS "routineBlocks" jsonb;
ALTER TABLE "system_sleep_routine_cache" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now();
ALTER TABLE "system_sleep_routine_cache" ALTER COLUMN "inputsFingerprint" SET NOT NULL;
ALTER TABLE "system_sleep_routine_cache" ALTER COLUMN "sleepBlocks" SET NOT NULL;
ALTER TABLE "system_sleep_routine_cache" ALTER COLUMN "routineBlocks" SET NOT NULL;
ALTER TABLE "system_sleep_routine_cache" ALTER COLUMN "updatedAt" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'system_sleep_routine_cache_userId_user_id_fk'
  ) THEN
    ALTER TABLE "system_sleep_routine_cache"
      ADD CONSTRAINT "system_sleep_routine_cache_userId_user_id_fk"
      FOREIGN KEY ("userId") REFERENCES "public"."user"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END$$;

COMMENT ON COLUMN "user_settings"."data" IS
  'UserSettings JSON; parsed and upgraded by migrateSettings() in @calendar-automations/schema (SETTINGS_SCHEMA_VERSION).';

COMMENT ON COLUMN "weekly_plan"."data" IS
  'WeeklyPlan JSON (goals, overrides, weeklyIntent); shape versioned in packages/schema.';

COMMIT;
