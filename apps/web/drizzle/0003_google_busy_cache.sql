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
ALTER TABLE "google_busy_cache" ADD CONSTRAINT "google_busy_cache_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
