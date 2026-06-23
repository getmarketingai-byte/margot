-- Sprint 3: Add onboarding / profile fields to user_profiles table.
-- New columns capture the 7 onboarding steps:
--   brand_voice, content_pillars, target_audience, posting_cadence,
--   signal_sources, sales_model, onboarding_complete

ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "brand_voice"         text,
  ADD COLUMN IF NOT EXISTS "content_pillars"     jsonb,
  ADD COLUMN IF NOT EXISTS "posting_cadence"     text,
  ADD COLUMN IF NOT EXISTS "signal_sources"      jsonb,
  ADD COLUMN IF NOT EXISTS "sales_model"         text,
  ADD COLUMN IF NOT EXISTS "onboarding_complete" text DEFAULT NULL;
