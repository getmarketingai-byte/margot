ALTER TABLE "user" ADD COLUMN "trialEndsAt" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "paymentGateBypass" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "user"
SET "trialEndsAt" = NOW() + INTERVAL '7 days'
WHERE "trialEndsAt" IS NULL
  AND ("subscriptionStatus" IS NULL OR "subscriptionStatus" = 'none');
