-- Margot: RLS policies and pgvector setup (NMA-1472 P0-3/P0-4)
-- Run AFTER ensure_uptodate.sql on a fresh Neon database.
-- Safe to run multiple times (all statements are idempotent).

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- P0-4: pgvector extension
-- ─────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

-- Vector columns for AI embeddings (spec section 13)
-- user_settings: embed the user's marketing context for similarity search
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS
  "marketing_context_embedding" vector(1536);

-- weekly_plan: embed goal descriptions for semantic planning
ALTER TABLE "weekly_plan" ADD COLUMN IF NOT EXISTS
  "goals_embedding" vector(1536);

-- daily_review: embed review notes for insight retrieval
ALTER TABLE "daily_review" ADD COLUMN IF NOT EXISTS
  "notes_embedding" vector(1536);

-- weekly_review: embed weekly summary for trend analysis
ALTER TABLE "weekly_review" ADD COLUMN IF NOT EXISTS
  "summary_embedding" vector(1536);

-- Indexes for vector similarity (cosine distance)
CREATE INDEX IF NOT EXISTS "user_settings_marketing_ctx_embedding_idx"
  ON "user_settings" USING ivfflat ("marketing_context_embedding" vector_cosine_ops)
  WITH (lists = 50);

CREATE INDEX IF NOT EXISTS "weekly_plan_goals_embedding_idx"
  ON "weekly_plan" USING ivfflat ("goals_embedding" vector_cosine_ops)
  WITH (lists = 50);

-- ─────────────────────────────────────────────────────────────────
-- P0-3: Multi-tenant Row Level Security
-- ─────────────────────────────────────────────────────────────────
-- Strategy: set_config('app.current_user_id', userId, true) in API routes
-- before executing queries. RLS policies then enforce isolation.
-- Auth.js tables (user, account, session, verificationToken) are controlled
-- by the Auth.js adapter and do not need RLS — they use server-side auth.

-- Enable RLS on all user-owned tables
ALTER TABLE "user_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "weekly_plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_snapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ics_custom_feed" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "google_busy_cache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "weather_forecast_cache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "system_sleep_routine_cache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feed_token" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_review" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "weekly_review" ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist (idempotent)
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename IN (
      'user_settings', 'weekly_plan', 'calendar_snapshot', 'ics_custom_feed',
      'google_busy_cache', 'weather_forecast_cache', 'system_sleep_routine_cache',
      'feed_token', 'daily_review', 'weekly_review'
    )
    AND policyname LIKE 'margot_%'
  ) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- user_settings
CREATE POLICY margot_user_settings_select ON "user_settings"
  FOR SELECT USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_user_settings_insert ON "user_settings"
  FOR INSERT WITH CHECK ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_user_settings_update ON "user_settings"
  FOR UPDATE USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_user_settings_delete ON "user_settings"
  FOR DELETE USING ("userId" = current_setting('app.current_user_id', true));

-- weekly_plan
CREATE POLICY margot_weekly_plan_select ON "weekly_plan"
  FOR SELECT USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_weekly_plan_insert ON "weekly_plan"
  FOR INSERT WITH CHECK ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_weekly_plan_update ON "weekly_plan"
  FOR UPDATE USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_weekly_plan_delete ON "weekly_plan"
  FOR DELETE USING ("userId" = current_setting('app.current_user_id', true));

-- calendar_snapshot
CREATE POLICY margot_calendar_snapshot_select ON "calendar_snapshot"
  FOR SELECT USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_calendar_snapshot_insert ON "calendar_snapshot"
  FOR INSERT WITH CHECK ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_calendar_snapshot_update ON "calendar_snapshot"
  FOR UPDATE USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_calendar_snapshot_delete ON "calendar_snapshot"
  FOR DELETE USING ("userId" = current_setting('app.current_user_id', true));

-- ics_custom_feed
CREATE POLICY margot_ics_custom_feed_select ON "ics_custom_feed"
  FOR SELECT USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_ics_custom_feed_insert ON "ics_custom_feed"
  FOR INSERT WITH CHECK ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_ics_custom_feed_update ON "ics_custom_feed"
  FOR UPDATE USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_ics_custom_feed_delete ON "ics_custom_feed"
  FOR DELETE USING ("userId" = current_setting('app.current_user_id', true));

-- google_busy_cache (userId is PK)
CREATE POLICY margot_google_busy_cache_select ON "google_busy_cache"
  FOR SELECT USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_google_busy_cache_insert ON "google_busy_cache"
  FOR INSERT WITH CHECK ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_google_busy_cache_update ON "google_busy_cache"
  FOR UPDATE USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_google_busy_cache_delete ON "google_busy_cache"
  FOR DELETE USING ("userId" = current_setting('app.current_user_id', true));

-- weather_forecast_cache (userId is PK)
CREATE POLICY margot_weather_forecast_cache_select ON "weather_forecast_cache"
  FOR SELECT USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_weather_forecast_cache_insert ON "weather_forecast_cache"
  FOR INSERT WITH CHECK ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_weather_forecast_cache_update ON "weather_forecast_cache"
  FOR UPDATE USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_weather_forecast_cache_delete ON "weather_forecast_cache"
  FOR DELETE USING ("userId" = current_setting('app.current_user_id', true));

-- system_sleep_routine_cache
CREATE POLICY margot_system_sleep_routine_cache_select ON "system_sleep_routine_cache"
  FOR SELECT USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_system_sleep_routine_cache_insert ON "system_sleep_routine_cache"
  FOR INSERT WITH CHECK ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_system_sleep_routine_cache_update ON "system_sleep_routine_cache"
  FOR UPDATE USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_system_sleep_routine_cache_delete ON "system_sleep_routine_cache"
  FOR DELETE USING ("userId" = current_setting('app.current_user_id', true));

-- feed_token
CREATE POLICY margot_feed_token_select ON "feed_token"
  FOR SELECT USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_feed_token_insert ON "feed_token"
  FOR INSERT WITH CHECK ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_feed_token_update ON "feed_token"
  FOR UPDATE USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_feed_token_delete ON "feed_token"
  FOR DELETE USING ("userId" = current_setting('app.current_user_id', true));

-- daily_review
CREATE POLICY margot_daily_review_select ON "daily_review"
  FOR SELECT USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_daily_review_insert ON "daily_review"
  FOR INSERT WITH CHECK ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_daily_review_update ON "daily_review"
  FOR UPDATE USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_daily_review_delete ON "daily_review"
  FOR DELETE USING ("userId" = current_setting('app.current_user_id', true));

-- weekly_review
CREATE POLICY margot_weekly_review_select ON "weekly_review"
  FOR SELECT USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_weekly_review_insert ON "weekly_review"
  FOR INSERT WITH CHECK ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_weekly_review_update ON "weekly_review"
  FOR UPDATE USING ("userId" = current_setting('app.current_user_id', true));
CREATE POLICY margot_weekly_review_delete ON "weekly_review"
  FOR DELETE USING ("userId" = current_setting('app.current_user_id', true));

-- ─────────────────────────────────────────────────────────────────
-- Verification query (run after applying to check RLS is active)
-- ─────────────────────────────────────────────────────────────────
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public'
-- AND tablename IN (
--   'user_settings', 'weekly_plan', 'calendar_snapshot', 'ics_custom_feed',
--   'google_busy_cache', 'weather_forecast_cache', 'system_sleep_routine_cache',
--   'feed_token', 'daily_review', 'weekly_review'
-- );
-- Expected: rowsecurity = true for all rows.

COMMIT;
