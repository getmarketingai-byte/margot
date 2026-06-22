CREATE TABLE "agent_run" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"agentName" text NOT NULL,
	"triggerKind" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"errorMessage" text,
	"durationMs" integer,
	"creditsUsed" integer DEFAULT 0,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "concept" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"parentId" text,
	"title" text NOT NULL,
	"description" text,
	"tags" jsonb,
	"status" text DEFAULT 'raw' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"company" text,
	"role" text,
	"stage" text DEFAULT 'lead' NOT NULL,
	"source" text,
	"tags" jsonb,
	"notes" text,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(12, 4) NOT NULL,
	"balance" numeric(12, 4) NOT NULL,
	"description" text,
	"agentRunId" text,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_review" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"date" text NOT NULL,
	"timezone" text NOT NULL,
	"data" jsonb NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_busy_cache" (
	"userId" text PRIMARY KEY NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"windowStartMs" text NOT NULL,
	"windowEndMs" text NOT NULL,
	"sourcesFingerprint" text NOT NULL,
	"busyEvents" jsonb NOT NULL,
	"goalAvailabilityWindows" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ics_custom_feed" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"title" text NOT NULL,
	"rules" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"platform" text,
	"scheduledAt" timestamp,
	"publishedAt" timestamp,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"template" text NOT NULL,
	"variables" jsonb,
	"agentName" text,
	"version" integer DEFAULT 1 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"source" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"summary" text,
	"metadata" jsonb,
	"capturedAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_sleep_routine_cache" (
	"userId" text NOT NULL,
	"weekStartIso" text NOT NULL,
	"inputsFingerprint" text NOT NULL,
	"sleepBlocks" jsonb NOT NULL,
	"routineBlocks" jsonb NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_sleep_routine_cache_userId_weekStartIso_pk" PRIMARY KEY("userId","weekStartIso")
);
--> statement-breakpoint
CREATE TABLE "weather_forecast_cache" (
	"userId" text PRIMARY KEY NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"coordsFingerprint" text NOT NULL,
	"openMeteoJson" jsonb,
	"openMeteoFetchedAtMs" text NOT NULL,
	"sunriseByDate" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_review" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"weekStart" text NOT NULL,
	"timezone" text NOT NULL,
	"data" jsonb NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "feed_token_user_feed";--> statement-breakpoint
ALTER TABLE "feed_token" ADD COLUMN "customFeedId" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "trialEndsAt" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "paymentGateBypass" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept" ADD CONSTRAINT "concept_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_agentRunId_agent_run_id_fk" FOREIGN KEY ("agentRunId") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_review" ADD CONSTRAINT "daily_review_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_busy_cache" ADD CONSTRAINT "google_busy_cache_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ics_custom_feed" ADD CONSTRAINT "ics_custom_feed_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post" ADD CONSTRAINT "post_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt" ADD CONSTRAINT "prompt_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal" ADD CONSTRAINT "signal_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_sleep_routine_cache" ADD CONSTRAINT "system_sleep_routine_cache_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_forecast_cache" ADD CONSTRAINT "weather_forecast_cache_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_review" ADD CONSTRAINT "weekly_review_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_review_user_date" ON "daily_review" USING btree ("userId","date");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_review_user_week" ON "weekly_review" USING btree ("userId","weekStart");--> statement-breakpoint
ALTER TABLE "feed_token" ADD CONSTRAINT "feed_token_customFeedId_ics_custom_feed_id_fk" FOREIGN KEY ("customFeedId") REFERENCES "public"."ics_custom_feed"("id") ON DELETE cascade ON UPDATE no action;